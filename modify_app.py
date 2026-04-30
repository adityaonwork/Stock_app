#!/usr/bin/env python3

# Read the original file
with open('src/App.jsx', 'r') as f:
    lines = f.readlines()

# Phase 1: Add rightPanelOpen state after waveform
insert_pos = None
for i, line in enumerate(lines):
    if 'const [waveform, setWaveform]' in line:
        insert_pos = i + 1
        break

if insert_pos:
    lines.insert(insert_pos, '  const [rightPanelOpen, setRightPanelOpen] = useState(false);\n')

# Write back
with open('src/App.jsx', 'w') as f:
    f.writelines(lines)

print("✓ Phase 1: Added rightPanelOpen state")
