'use client';

import { Flex, Box, Heading, Button, Spacer } from '@chakra-ui/react';
import Link from 'next/link';

export function Navbar() {
  return (
    <Flex as="nav" bg="gray.800" color="white" p={4} align="center" borderBottomWidth="1px" borderColor="gray.700">
      <Box p="2">
        <Heading size="md">
          <Link href="/">SQLLens</Link>
        </Heading>
      </Box>
      <Spacer />
      <Flex gap={4}>
        <Link href="/dashboard" passHref>
          <Button variant="ghost" colorPalette="gray">
            Dashboard
          </Button>
        </Link>
        <Link href="/review" passHref>
          <Button variant="ghost" colorPalette="gray">
            Review SP
          </Button>
        </Link>
        <Link href="/compare" passHref>
          <Button variant="ghost" colorPalette="gray">
            Compare
          </Button>
        </Link>
        <Link href="/execute" passHref>
          <Button variant="ghost" colorPalette="gray">
            Execute
          </Button>
        </Link>
        <Button colorPalette="blue" ml={4}>
          Login
        </Button>
      </Flex>
    </Flex>
  );
}
