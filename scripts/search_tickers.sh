#!/bin/bash

# Read tickers from file and search Jupiter API
OUTPUT_FILE="data/jupiter_tokens/searched_tokens.json"

echo "[" > $OUTPUT_FILE

first=true
while IFS= read -r ticker; do
  [[ -z "$ticker" ]] && continue

  result=$(curl -s "https://lite-api.jup.ag/tokens/v2/search?query=$ticker" | jq '.[0] // empty')

  if [[ -n "$result" ]]; then
    if [[ "$first" = false ]]; then
      echo "," >> $OUTPUT_FILE
    fi
    echo "$result" >> $OUTPUT_FILE
    first=false

    # Print to console
    symbol=$(echo "$result" | jq -r '.symbol')
    mcap=$(echo "$result" | jq -r '.mcap')
    echo "✓ Found: $symbol (MCap: \$$(echo "scale=2; $mcap/1000000" | bc)M)"
  else
    echo "✗ Not found: $ticker"
  fi

  sleep 0.2
done < data/manual_tickers.txt

echo "]" >> $OUTPUT_FILE

echo ""
echo "Saved to: $OUTPUT_FILE"
echo "Run: npm run bulk-add -- $OUTPUT_FILE"