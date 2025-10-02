#!/bin/bash
# Helper script to review pending programs

REGISTRY="src/data/program_registry.json"

echo "================================================"
echo "  Program Registry Review Helper"
echo "================================================"
echo ""

# Check if registry exists
if [ ! -f "$REGISTRY" ]; then
    echo "❌ Registry not found at $REGISTRY"
    exit 1
fi

# Count pending programs
PENDING_COUNT=$(cat "$REGISTRY" | jq '.pending_review | length')
echo "📋 Programs pending review: $PENDING_COUNT"
echo ""

if [ "$PENDING_COUNT" -eq 0 ]; then
    echo "✅ All programs are classified!"
    exit 0
fi

# Show top 10 pending programs
echo "🔍 Top 10 programs to review (by frequency):"
echo ""
cat "$REGISTRY" | jq -r '.pending_review[:10] | .[] | "[\(.count)] \(.programId)\n       → \(.solscan_url)\n"'

echo ""
echo "================================================"
echo "Next steps:"
echo "1. Visit the Solscan URLs above"
echo "2. Classify each program (see PROGRAM_REVIEW_GUIDE.md)"
echo "3. Edit $REGISTRY to move programs from pending_review to programs"
echo ""
echo "Quick commands:"
echo "  # View all pending programs"
echo "  cat $REGISTRY | jq '.pending_review'"
echo ""
echo "  # Validate JSON after editing"
echo "  cat $REGISTRY | jq . > /dev/null && echo 'Valid!'"
echo ""
echo "  # Count remaining"
echo "  cat $REGISTRY | jq '.pending_review | length'"
echo "================================================"
