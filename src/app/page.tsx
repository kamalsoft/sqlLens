import { Box, Container, Heading, Text, Button, Flex } from '@chakra-ui/react';
import Link from 'next/link';

export default function Home() {
  return (
    <Box minH="100vh" bg="gray.900" color="white">
      <Container maxW="container.xl" py={20}>
        <Flex direction="column" align="center" textAlign="center" gap={8}>
          <Heading as="h1" size="4xl" bgGradient="to-r" gradientFrom="blue.400" gradientTo="purple.500" bgClip="text">
            SQLLens
          </Heading>
          
          <Text fontSize="xl" color="gray.300" maxW="2xl">
            AI-powered Stored Procedure Analyzer. Review, compare, and optimize your SQL code with deep insights and 5 Why's recommendations.
          </Text>

          <Flex gap={4} mt={8}>
            <Link href="/dashboard" passHref>
              <Button size="lg" colorPalette="blue">
                Go to Dashboard
              </Button>
            </Link>
            <Link href="/review" passHref>
              <Button size="lg" variant="outline" colorPalette="gray">
                Start a Review
              </Button>
            </Link>
          </Flex>
        </Flex>
      </Container>
    </Box>
  );
}
