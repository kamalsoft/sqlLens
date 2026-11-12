"use client";

import { ChakraProvider } from "@chakra-ui/react";
import { EmotionRegistry } from "./emotion-registry";
import { sqllensSystem } from "../lib/theme";
import { LeaveGuardProvider } from "../components/leave-guard";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <EmotionRegistry>
      <ChakraProvider value={sqllensSystem}>
        <LeaveGuardProvider>{children}</LeaveGuardProvider>
      </ChakraProvider>
    </EmotionRegistry>
  );
}
