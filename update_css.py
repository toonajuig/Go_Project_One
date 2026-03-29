import re

with open('styles.css', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Variables
content = re.sub(
    r':root \{.*?\n\}',
    ''':root {
  --bg-top: #1a1c22;
  --bg-bottom: #090a0d;
  --ink: #e2e8f0;
  --muted: #8b9eb5;
  --panel: rgba(26, 30, 35, 0.86);
  --panel-strong: rgba(35, 41, 49, 0.96);
  --line: rgba(30, 15, 0, 0.85);
  --accent: #dca54c;
  --accent-soft: rgba(220, 165, 76, 0.14);
  --sand: #d0aa63;
  --sand-soft: #e7c98c;
  --warning: #ff784f;
  --shadow: 0 28px 60px rgba(0, 0, 0, 0.6);
  --radius-xl: 28px;
  --radius-lg: 20px;
  --radius-md: 14px;
}''',
    content,
    flags=re.DOTALL
)

# 2. .ambient
content = re.sub(
    r'\.ambient-left \{[\s\S]*?\}',
    '''.ambient-left {
  top: -10rem;
  left: -12rem;
  background: radial-gradient(circle, rgba(220, 165, 76, 0.15), transparent 70%);
}''',
    content
)

content = re.sub(
    r'\.ambient-right \{[\s\S]*?\}',
    '''.ambient-right {
  right: -12rem;
  bottom: -14rem;
  background: radial-gradient(circle, rgba(50, 65, 80, 0.3), transparent 68%);
}''',
    content
)

# 3. .hero-card
content = re.sub(
    r'\.hero-card \{[\s\S]*?border: 1px solid.*?;\n\}',
    '''.hero-card {
  padding: 1.4rem 1.45rem;
  border-radius: var(--radius-lg);
  background:
    linear-gradient(135deg, rgba(35, 41, 49, 0.92), rgba(26, 30, 35, 0.8)),
    linear-gradient(120deg, rgba(220, 165, 76, 0.08), rgba(139, 158, 181, 0.05));
  border: 1px solid rgba(80, 90, 100, 0.46);
}''',
    content
)

# 4. .primary-button
content = re.sub(
    r'\.primary-button \{\s*background: linear-gradient.*?\n\s*color:.*?\n\s*box-shadow:.*?\n\}',
    '''.primary-button {
  background: linear-gradient(135deg, #dca54c, #b38031);
  color: #1a1c22;
  box-shadow: 0 16px 28px rgba(220, 165, 76, 0.22);
}''',
    content
)

# 5. .secondary-button
content = re.sub(
    r'\.secondary-button,\s*\.prompt-chip \{\s*background:.*?\n\s*color: var\(--ink\);\n\s*border:.*?\n\}',
    '''.secondary-button,
.prompt-chip {
  background: rgba(45, 52, 60, 0.92);
  color: var(--ink);
  border: 1px solid rgba(139, 158, 181, 0.38);
}''',
    content
)

# 6. .status-card
content = re.sub(
    r'\.status-card \{[\s\S]*?border: 1px solid.*?;',
    '''.status-card {
  padding: 1rem;
  border-radius: var(--radius-md);
  background: var(--panel-strong);
  border: 1px solid rgba(80, 90, 100, 0.42);''',
    content
)

# 7. .status-note
content = re.sub(
    r'\.status-note \{[\s\S]*?background:.*?;[\s\S]*?border:.*?;',
    '''.status-note {
  margin: 0;
  padding: 0.95rem 1rem;
  border-radius: var(--radius-md);
  background: rgba(45, 52, 60, 0.74);
  border: 1px solid rgba(139, 158, 181, 0.4);''',
    content
)


# 8. .board-card
content = re.sub(
    r'\.board-card \{[\s\S]*?border-radius: var\(--radius-lg\);[\s\S]*?background:[\s\S]*?border: 1px solid.*?;',
    '''.board-card {
  padding: 1rem;
  border-radius: var(--radius-lg);
  background:
    linear-gradient(145deg, rgba(35, 41, 49, 0.86), rgba(26, 30, 35, 0.72)),
    linear-gradient(145deg, rgba(220, 165, 76, 0.08), rgba(255, 255, 255, 0));
  border: 1px solid rgba(80, 90, 100, 0.44);''',
    content
)

# 9. .board-grid
content = re.sub(
    r'\.board-grid \{[\s\S]*?box-shadow:[\s\S]*?rgba\(.*?\}\n',
    '''.board-grid {
  --cell-size: clamp(42px, 5.4vw, 56px);
  display: grid;
  grid-template-columns: repeat(9, var(--cell-size));
  grid-template-rows: repeat(9, var(--cell-size));
  background-image: url('./assets/wood_texture.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  padding: 0.4rem;
  border-radius: 22px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    inset 0 -18px 34px rgba(0, 0, 0, 0.6),
    0 20px 46px rgba(0, 0, 0, 0.7);
}
''',
    content
)

# 10. scoring panel
content = re.sub(
    r'\.scoring-panel \{[\s\S]*?background:[\s\S]*?border: 1px solid.*?;',
    '''.scoring-panel {
  padding: 1.1rem 1.15rem;
  border-radius: var(--radius-lg);
  background:
    linear-gradient(145deg, rgba(35, 41, 49, 0.94), rgba(26, 30, 35, 0.88)),
    linear-gradient(135deg, rgba(220, 165, 76, 0.08), rgba(139, 158, 181, 0.05));
  border: 1px solid rgba(80, 90, 100, 0.42);''',
    content
)

# 11. scoring card
content = re.sub(
    r'\.scoring-card \{[\s\S]*?background: rgba.*?;[\s\S]*?border: 1px solid.*?;',
    '''.scoring-card {
  padding: 0.95rem 1rem;
  border-radius: var(--radius-md);
  background: rgba(45, 52, 60, 0.92);
  border: 1px solid rgba(139, 158, 181, 0.44);''',
    content
)

# 12 neutral
content = re.sub(
    r'\.scoring-card-neutral \{\s*background:.*?;',
    '''.scoring-card-neutral {
  background: rgba(35, 41, 49, 0.92);''',
    content
)

# 13 mood pill
content = re.sub(
    r'\.mood-pill \{[\s\S]*?background: rgba.*?;[\s\S]*?border: 1px solid.*?;',
    '''.mood-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 0.8rem;
  border-radius: 999px;
  font-size: 0.9rem;
  background: rgba(45, 52, 60, 0.92);
  border: 1px solid rgba(139, 158, 181, 0.4);''',
    content
)

# 14 chat bubbles
content = re.sub(
    r'\.message\.assistant \.message-bubble \{\s*background:.*?;[\s\S]*?border:.*?;',
    '''.message.assistant .message-bubble {
  background: rgba(35, 41, 49, 0.96);
  border: 1px solid rgba(80, 90, 100, 0.42);''',
    content
)

content = re.sub(
    r'\.message\.user \.message-bubble \{\s*background:.*?;[\s\S]*?color:.*?;',
    '''.message.user .message-bubble {
  background: rgba(220, 165, 76, 0.92);
  color: #1a1c22;''',
    content
)

content = re.sub(
    r'\.message\.system \.message-bubble \{\s*background:.*?;[\s\S]*?border:.*?;',
    '''.message.system .message-bubble {
  background: rgba(45, 52, 60, 0.68);
  border: 1px dashed rgba(139, 158, 181, 0.36);''',
    content
)

# 15 chat input
content = re.sub(
    r'\.chat-form textarea \{[\s\S]*?color: var\(--ink\);[\s\S]*?background:.*?;',
    '''.chat-form textarea {
  resize: vertical;
  min-height: 88px;
  border-radius: 18px;
  border: 1px solid rgba(139, 158, 181, 0.42);
  padding: 0.95rem 1rem;
  color: var(--ink);
  background: rgba(35, 41, 49, 0.94);''',
    content
)


with open('styles.css', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated styles.css")
