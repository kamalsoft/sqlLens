#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1] / "downloads" / "models"

WEIGHT_EXTENSIONS = (
    ".safetensors",
    ".bin",
    ".pt",
    ".pth",
    ".onnx",
)

PRESERVE_FAILED_DOWNLOADS = True


class ModelValidationError(Exception):
    pass


def fetch_json(url: str, token: str | None = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    request = Request(url, headers=headers)

    with urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def download_file(url: str, destination: Path, token: str | None = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    request = Request(url, headers=headers)

    destination.parent.mkdir(parents=True, exist_ok=True)

    with urlopen(request, timeout=300) as response, destination.open("wb") as output:
        total = int(response.headers.get("Content-Length", "0"))
        downloaded = 0

        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            downloaded += len(chunk)

            if total:
                percent = downloaded * 100 // total
                print(f"  {destination.name}: {percent}%", end="\r")

    print(f"  {destination.name}: complete")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)

    return digest.hexdigest()


def parse_checksum_manifests(root: Path) -> dict[str, str]:
    checksums: dict[str, str] = {}

    for manifest in ("SHA256SUMS", "sha256sums", "checksums.txt"):
        path = root / manifest

        if not path.is_file():
            continue

        for line in path.read_text(errors="replace").splitlines():
            parts = line.strip().split()

            if len(parts) >= 2 and len(parts[0]) == 64:
                checksums[parts[-1].lstrip("*./")] = parts[0].lower()

    return checksums


def discover_architecture(metadata: dict) -> dict:
    config = metadata.get("config", {})
    model_type = config.get("model_type", "unknown")
    architectures = config.get("architectures", [])

    if any("CausalLM" in item for item in architectures):
        family = "causal-lm"
    elif any("ForSequenceClassification" in item for item in architectures):
        family = "sequence-classification"
    elif "bert" in model_type.lower():
        family = "bert"
    elif "llama" in model_type.lower():
        family = "llama"
    elif "mistral" in model_type.lower():
        family = "mistral"
    else:
        family = model_type

    return {
        "family": family,
        "modelType": model_type,
        "architectures": architectures,
    }


def validate_structure(root: Path, files: list[str], architecture: dict):
    relative_files = {
        file.replace(os.sep, "/")
        for file in files
    }

    weights = sorted(
        file
        for file in relative_files
        if file.lower().endswith(WEIGHT_EXTENSIONS)
    )

    missing = []

    if "config.json" not in relative_files:
        missing.append("config.json")

    if not weights:
        missing.append(
            "at least one model weight file "
            "(.safetensors, .bin, .pt, .pth, or .onnx)"
        )

    tokenizer_files = {
        "tokenizer.json",
        "tokenizer.model",
        "vocab.json",
        "spiece.model",
    }

    tokenizer_matches = sorted(
        relative_files.intersection(tokenizer_files)
    )

    if not tokenizer_matches:
        missing.append("tokenizer asset")

    empty = sorted(
        file
        for file in relative_files
        if (root / file).is_file()
        and (root / file).stat().st_size == 0
    )

    if missing or empty:
        details = {
            "stage": "structure",
            "architecture": architecture,
            "root": str(root),
            "filesReceivedFromRepository": sorted(relative_files),
            "weightFilesDetected": weights,
            "tokenizerFilesDetected": tokenizer_matches,
            "missing": missing,
            "emptyFiles": empty,
        }

        raise ModelValidationError(
            json.dumps(
                {
                    "message": (
                        f"Invalid {architecture['family']} model structure"
                    ),
                    "details": details,
                },
                indent=2,
            )
        )


def verify_checksums(root: Path, expected: dict[str, str]):
    actual: dict[str, str] = {}
    mismatches: list[dict[str, str]] = []

    files = sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.name != "checksums.json"
    )

    for index, path in enumerate(files, start=1):
        relative = path.relative_to(root).as_posix()
        digest = sha256_file(path)
        actual[relative] = digest

        expected_digest = expected.get(relative)

        if expected_digest and expected_digest.lower() != digest:
            mismatches.append(
                {
                    "file": relative,
                    "expected": expected_digest.lower(),
                    "actual": digest,
                }
            )

        print(f"  checksum {index}/{len(files)}: {relative}")

    report = {
        "algorithm": "sha256",
        "files": actual,
        "expectedFiles": sorted(expected),
        "mismatches": mismatches,
        "verified": not mismatches,
    }

    (root / "checksums.json").write_text(
        json.dumps(report, indent=2),
        encoding="utf-8",
    )

    if mismatches:
        raise ModelValidationError(
            json.dumps(
                {
                    "message": "Checksum verification failed",
                    "details": report,
                },
                indent=2,
            )
        )


def write_failure_report(
    temporary: Path,
    model_id: str,
    error: Exception,
):
    report = {
        "modelId": model_id,
        "temporaryPath": str(temporary),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "errorType": type(error).__name__,
        "errorMessage": str(error),
        "traceback": traceback.format_exc(),
    }

    report_path = temporary / "validation-error.json"
    report_path.write_text(
        json.dumps(report, indent=2),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "validationFailed": True,
                "report": str(report_path),
                **report,
            },
            indent=2,
        ),
        file=sys.stderr,
    )


def download_model(model_id: str, token: str | None):
    if "/" not in model_id:
        raise ModelValidationError("Model ID must use the owner/model format")

    owner, repository = model_id.split("/", 1)
    destination = ROOT / model_id.replace("/", "_")
    temporary = Path(tempfile.mkdtemp(prefix=f"{destination.name}.", dir=ROOT))

    try:
        print(f"[1/5] Reading repository metadata: {model_id}")

        api_url = (
            f"https://huggingface.co/api/models/"
            f"{quote(owner)}/{quote(repository)}"
        )
        metadata = fetch_json(api_url, token)
        architecture = discover_architecture(metadata)
        print(f"      Architecture: {architecture}")

        siblings = metadata.get("siblings", [])
        files = [
            item["rfilename"]
            for item in siblings
            if item.get("rfilename")
        ]

        if not files:
            raise ModelValidationError("Repository contains no files")

        print(f"[2/5] Mirroring {len(files)} repository files")

        expected: dict[str, str] = {}

        for item in siblings:
            filename = item.get("rfilename")
            lfs = item.get("lfs", {})

            if filename and lfs.get("sha256"):
                expected[filename] = lfs["sha256"]

        for filename in files:
            encoded_path = "/".join(quote(part) for part in filename.split("/"))
            url = (
                f"https://huggingface.co/{quote(owner)}/"
                f"{quote(repository)}/resolve/main/{encoded_path}"
            )
            download_file(url, temporary / filename, token)

        print("[3/5] Validating directory structure")
        validate_structure(temporary, files, architecture)

        print("[4/5] Verifying checksums")
        expected.update(parse_checksum_manifests(temporary))
        verify_checksums(temporary, expected)

        metadata_file = temporary / "sqlens-model.json"
        metadata_file.write_text(
            json.dumps(
                {
                    "id": model_id,
                    "name": repository,
                    "sourceUrl": f"https://huggingface.co/{model_id}",
                    "architecture": architecture,
                    "validated": True,
                },
                indent=2,
            )
        )

        print("[5/5] Finalizing validated model")
        if destination.exists():
            shutil.rmtree(destination)

        temporary.rename(destination)
        print(f"VALID: {destination}")
        return destination

    except Exception as error:
        write_failure_report(temporary, model_id, error)

        if not PRESERVE_FAILED_DOWNLOADS:
            shutil.rmtree(temporary, ignore_errors=True)
        else:
            print(
                f"FAILED DOWNLOAD PRESERVED: {temporary}",
                file=sys.stderr,
            )

        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model_id")
    parser.add_argument(
        "--token",
        default=os.environ.get("HF_TOKEN"),
    )
    args = parser.parse_args()

    ROOT.mkdir(parents=True, exist_ok=True)

    try:
        download_model(args.model_id, args.token)
    except Exception as error:
        print(f"INVALID: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()