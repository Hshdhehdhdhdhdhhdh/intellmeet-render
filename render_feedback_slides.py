from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path('/home/ubuntu/intellmeet-deliverables')
OUT.mkdir(parents=True, exist_ok=True)
FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
MONO_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
W, H = 1280, 720

def font(path, size):
    return ImageFont.truetype(path, size)

def slide(title, subtitle, code_lines, filename):
    image = Image.new('RGB', (W, H), '#151529')
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, W, 70), fill='#22213d')
    draw.ellipse((24, 27, 36, 39), fill='#f27c7c')
    draw.ellipse((44, 27, 56, 39), fill='#f3bd67')
    draw.ellipse((64, 27, 76, 39), fill='#69c9aa')
    draw.text((105, 18), title, font=font(BOLD_PATH, 24), fill='#f7f7ff')
    draw.text((105, 45), subtitle, font=font(FONT_PATH, 11), fill='#a8a7c5')
    draw.rectangle((45, 104, 1235, 675), fill='#1d1c35', outline='#373451', width=2)
    y = 128
    for line in code_lines:
        color = '#c7c4e1'
        if line.startswith('//') or line.startswith('#'):
            color = '#8b88ad'
        elif 'export' in line or 'return' in line or 'const' in line or 'function' in line:
            color = '#8ed5ef'
        elif 'className' in line or 'onClick' in line:
            color = '#d8a5f0'
        elif 'Meeting' in line or 'workspace' in line or 'action' in line:
            color = '#a9dfab'
        draw.text((78, y), line, font=font(MONO_PATH, 16), fill=color)
        y += 29
        if y > 640:
            break
    image.save(OUT / filename)

slide('client/src/pages/Home.tsx', 'React interaction layer · meeting workflow and persistence', [
    'export type Meeting = {',
    '  id: number; title: string; time: string;',
    '  date: string; participants: number;',
    '  status: "Live now" | "Upcoming" | "Completed";',
    '};',
    '',
    'export function filterMeetings(items: Meeting[], query: string) {',
    '  const normalized = query.trim().toLowerCase();',
    '  return normalized',
    '    ? items.filter((meeting) =>',
    '        meeting.title.toLowerCase().includes(normalized))',
    '    : items;',
    '}',
    '',
    'const createMeeting = () => {',
    '  persistMeetings([meeting, ...meetings]);',
    '  setActiveMeeting(meeting);',
    '};',
], 'feedback-code-home.png')

slide('client/src/index.css', 'Visual system · responsive layouts and calm enterprise UI', [
    ':root {',
    '  --background: #f7f8fc;',
    '  --foreground: #202035;',
    '  --primary: #6e5bea;',
    '  --teal: #27b8a3;',
    '  --shadow: 0 8px 30px rgba(42, 37, 90, .045);',
    '}',
    '',
    '.app-shell { display: flex; min-height: 100vh; }',
    '.sidebar { width: 244px; background: #fff; }',
    '.dashboard-grid {',
    '  display: grid;',
    '  grid-template-columns: 1.35fr 1fr;',
    '  gap: 14px;',
    '}',
    '',
    '@media (max-width: 760px) {',
    '  .sidebar { width: 67px; }',
    '  .dashboard-grid { grid-template-columns: 1fr; }',
    '  .meeting-grid { grid-template-columns: 1fr; }',
    '}',
], 'feedback-code-css.png')

slide('Project learning and next steps', 'What I learned while building IntellMeet', [
    '01  Product thinking',
    '    Design the workflow from conversation to execution.',
    '',
    '02  Interaction design',
    '    Keep dense enterprise features calm and discoverable.',
    '',
    '03  Reliable demos',
    '    Use meaningful states, persistence, and clear feedback.',
    '',
    '04  Next production milestone',
    '    MongoDB + tRPC persistence, Socket.io room events,',
    '    WebRTC transport, transcription, and OpenAI APIs.',
], 'feedback-learning.png')
