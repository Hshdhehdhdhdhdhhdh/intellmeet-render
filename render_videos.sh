#!/usr/bin/env bash
set -euo pipefail

DESKTOP="/home/ubuntu/screenshots/webdev-preview-root-1789983203761473175-6774.png"
MOBILE="/home/ubuntu/screenshots/webdev-preview-root-1789983215060769467-7148.png"
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

ffmpeg -y -loglevel error \
  -loop 1 -i "$DESKTOP" \
  -loop 1 -i "$MOBILE" \
  -i /home/ubuntu/intellmeet/intellmeet-demo-narration.wav \
  -filter_complex "\
    [0:v]trim=duration=45,setpts=PTS-STARTPTS,fps=30,scale=1120:650:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#f8f8fc,drawtext=fontfile=${FONT}:text='INTELLMEET  |  AI MEETING WORKSPACE':fontcolor=#2f2e4b:fontsize=22:x=42:y=28:enable='between(t,0,5)'[desktop];\
    [1:v]trim=duration=23,setpts=PTS-STARTPTS,fps=30,scale=250:680:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#f8f8fc,drawtext=fontfile=${FONT}:text='RESPONSIVE WORKSPACE VIEW':fontcolor=#2f2e4b:fontsize=22:x=42:y=28:enable='between(t,0,5)'[mobile];\
    [desktop][mobile]concat=n=2:v=1:a=0,format=yuv420p[v]" \
  -map "[v]" -map 2:a -t 68.2 -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 128k -movflags +faststart \
  /home/ubuntu/intellmeet/INTELLMEET_DEMO_VIDEO.mp4

ffmpeg -y -loglevel error \
  -loop 1 -i "$DESKTOP" \
  -i /home/ubuntu/intellmeet/intellmeet-feedback-narration.wav \
  -filter_complex "\
    [0:v]trim=duration=48.36,setpts=PTS-STARTPTS,fps=30,scale=1120:650:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#f8f8fc,drawtext=fontfile=${FONT}:text='INTELLMEET  |  BUILD REFLECTION':fontcolor=#2f2e4b:fontsize=22:x=42:y=28:enable='between(t,0,5)',format=yuv420p[v]" \
  -map "[v]" -map 1:a -t 48.36 -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 128k -movflags +faststart \
  /home/ubuntu/intellmeet/INTELLMEET_FEEDBACK_VIDEO.mp4

for video in /home/ubuntu/intellmeet/INTELLMEET_*VIDEO.mp4; do
  echo "--- $video"
  ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$video"
done
