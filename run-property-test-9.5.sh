#!/bin/bash

# Property Test 9.5: Tool Call Retry Policy
# This script runs the property-based test for Property 12

echo "Running Property Test 12: Tool Call Retry Policy"
echo "================================================="
echo ""
echo "Property Statement:"
echo "For any failed tool call where the tool's execution policy specifies a retry"
echo "count greater than zero, the MCP_Interface SHALL retry the call up to the"
echo "configured number of times before returning a final failure state."
echo ""
echo "Validates: Requirements 5.5, 21.3"
echo ""
echo "Running test..."
echo ""

npx vitest --run src/tests/properties/tool-call-retry-policy.property.test.ts

echo ""
echo "Test execution complete."
