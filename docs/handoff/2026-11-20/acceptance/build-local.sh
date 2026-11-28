#!/bin/sh
# Production build with the Google fonts stubbed (no internet here), then restore, then serve on 3001.
cd /home/claude/talal-claude
pkill -f next-server 2>/dev/null; pkill -f "next start" 2>/dev/null; sleep 1
cp apps/web/app/layout.tsx /tmp/layout.bak
python3 - <<'PY'
p='apps/web/app/layout.tsx'; s=open(p).read()
s=s.replace('import { Inter, IBM_Plex_Sans_Arabic } from "next/font/google";\n','')
import re
s=re.sub(r'const inter = Inter\(.*?\);\nconst plexArabic = IBM_Plex_Sans_Arabic\(\{.*?\}\);', 'const inter = { variable: "" };\nconst plexArabic = { variable: "" };', s, flags=re.S)
open(p,'w').write(s)
PY
npm run build > /tmp/build.log 2>&1; code=$?
cp /tmp/layout.bak apps/web/app/layout.tsx
echo "build exit $code"
[ $code -eq 0 ] || exit 1
cd apps/web && (nohup npx next start -p 3001 > /tmp/start.log 2>&1 &)
sleep 6
