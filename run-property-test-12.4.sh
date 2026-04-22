#!/bin/bash

# Property Test 12.4: WhatsApp UI Limit Compliance
# Validates: Requirements 7.7, 15.1, 15.2

echo "Running Property Test 12.4: WhatsApp UI Limit Compliance"
echo "=========================================================="
echo ""
echo "Property Statement:"
echo "For any outbound WhatsApp message, the WhatsApp_Renderer SHALL validate"
echo "the message against WhatsApp UI limits (button counts, list item counts,"
echo "text lengths) before delivery; messages that exceed limits SHALL be"
echo "reformatted or fall back to plain text."
echo ""
echo "Validates: Requirements 7.7, 15.1, 15.2"
echo ""

npm test -- src/tests/properties/whatsapp-ui-limit-compliance.property.test.ts
