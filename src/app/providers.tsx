"use client";

import { ChakraProvider } from "@chakra-ui/react";
import { EmotionRegistry } from "./emotion-registry";
import { sqllensSystem } from "../lib/theme";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <EmotionRegistry>
      <ChakraProvider value={sqllensSystem}>{children}</ChakraProvider>
    </EmotionRegistry>
  );
}
