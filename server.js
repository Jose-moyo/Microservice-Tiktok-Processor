const express = require('express');
const axios = require('axios');
const ffmpegStatic = require('ffmpeg-static');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const BACKGROUND = path.join(__dirname, 'BACK1.jpg');
const TMP = '/tmp';

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));

// ─── Main route ──────────────────────────────────────────────────────────────
app.post('/process', async (req, res) => {
  const { tiktokUrl, chatId, botToken } = req.body;

  if (!tiktokUrl || !chatId || !botToken) {
    return res.status(400).json({ error: 'Missing params: tiktokUrl, chatId, botToken' });
  }

  const ts = Date.now();
  const inputFile  = path.join(TMP, `tiktok_${ts}.mp4`);
  const outputFile = path.join(TMP, `reels_${ts}.mp4`);

  const cleanup = () => {
    try { fs.unlinkSync(inputFile);  } catch {}
    try { fs.unlinkSync(outputFile); } catch {}
  };

  try {
    // ── 1. Get TikTok video URL + title (tikwm.com — free, no key) ──────────
    console.log(`[${ts}] Fetching TikTok metadata...`);
    const tikwm = await axios.post(
      'https://tikwm.com/api/',
      `url=${encodeURIComponent(tiktokUrl)}&hd=1`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );

    const data = tikwm.data?.data;
    if (!data) throw new Error('tikwm API returned no data');

    const videoUrl = data.hdplay || data.play;
    const title    = (data.title || 'Vidéo TikTok').substring(0, 200);
    console.log(`[${ts}] Title: ${title}`);

    // ── 2. Download video ────────────────────────────────────────────────────
    console.log(`[${ts}] Downloading video...`);
    const videoRes = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    fs.writeFileSync(inputFile, Buffer.from(videoRes.data));
    console.log(`[${ts}] Video saved: ${inputFile}`);

    // ── 3. FFmpeg: overlay video on background image ─────────────────────────
    // Background scaled to 1080×1920 (9:16)
    // Video scaled to 90% = max 972×1728, centered, aspect ratio preserved
    console.log(`[${ts}] Running FFmpeg...`);
    const ffmpegCmd = [
      ffmpegStatic,
      '-loop 1',
      `-i "${BACKGROUND}"`,
      `-i "${inputFile}"`,
      '-filter_complex',
      '"[0:v]scale=1080:1920,setsar=1[bg];[1:v]scale=w=972:h=1728:force_original_aspect_ratio=decrease,setsar=1[vid];[bg][vid]overlay=(W-w)/2:(H-h)/2:shortest=1"',
      '-c:v libx264 -preset fast -crf 23',
      '-c:a aac -b:a 128k',
      '-movflags +faststart',
      '-shortest',
      `-y "${outputFile}"`
    ].join(' ');

    execSync(ffmpegCmd, { timeout: 180000 });
    console.log(`[${ts}] FFmpeg done: ${outputFile}`);

    // ── 4. Send to Telegram ──────────────────────────────────────────────────
    console.log(`[${ts}] Sending to Telegram chat ${chatId}...`);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', `🎬 *${title}*\n\n✅ Reels 1080×1920 prêt 🚀`);
    form.append('parse_mode', 'Markdown');
    form.append('video', fs.createReadStream(outputFile), {
      filename: 'reels.mp4',
      contentType: 'video/mp4'
    });

    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendVideo`,
      form,
      {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 120000
      }
    );
    console.log(`[${ts}] Sent!`);

    cleanup();
    res.json({ success: true, title });

  } catch (err) {
    cleanup();
    console.error(`[${ts}] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ TikTok Processor running on port ${PORT}`));
