"use client";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { EmotionRegistry } from "./emotion-registry";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <EmotionRegistry>
      <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
    </EmotionRegistry>
  );
}
