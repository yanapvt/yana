#!/bin/bash

# Property Test 7.4: LLM Output Validation Before Execution
# This script runs the property-based test for Property 8

echo "Running Property Test 8: LLM Output Validation Before Execution"
echo "================================================================"
echo ""
echo "Property Statement:"
echo "For any LLM decision output, the Orchestrator SHALL validate the output"
echo "against schema and business rules before taking any action; invalid LLM"
echo "outputs SHALL not result in tool execution, booking, or payment actions."
echo ""
echo "Validates: Requirements 4.3, 4.4"
echo ""
echo "Running test..."
echo ""

npx vitest --run src/tests/properties/llm-output-validation.property.test.ts

echo ""
echo "Test execution complete."
