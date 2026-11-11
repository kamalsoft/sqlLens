"use client";

import { Button, Dialog, Portal, Text } from "@chakra-ui/react";

/** A yes/no question in a modal: used before leaving a screen, or closing a popup, while a task runs. */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) onCancel(); }} role="alertdialog" placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.panel" color="fg.default" borderWidth="1px" borderColor="border.subtle">
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text color="fg.muted">{message}</Text>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" colorPalette="gray" onClick={onCancel}>{cancelLabel}</Button>
              <Button variant="outline" color="status.bad" borderColor="status.bad" onClick={onConfirm}>{confirmLabel}</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
