"""Build Retail Local narration with the pinned cost/pricing voice. Offline authoring only."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import time
import numpy as np
import soundfile as sf
from fastthaig2p import TTS
from pythainlp.tokenize import word_tokenize
from pythainlp.util import num_to_thaiword

parser = argparse.ArgumentParser()
parser.add_argument('--model-dir', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'apps/web/public/audio/retail-local/th'
out.mkdir(parents=True, exist_ok=True)
# Reuse the pinned model checks and pronunciation normalization without its CLI side effects.
source = root / 'scripts/generate-restaurant-thai-audio.py'
names = {'vocabulary', 'indices', 'pronunciation', 'model_hashes'}
nodes = [node for node in ast.parse(source.read_text(encoding='utf-8')).body if
         (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in node.targets))
         or (isinstance(node, ast.FunctionDef) and node.name == 'normalize')]
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'))
pronunciation.update({
    'Activate or Transfer': 'แอ็กทิเวต ออร์ ทรานสเฟอร์', 'Activation Code': 'แอ็กทิเวชัน โค้ด',
    'Server + POS': 'เซิร์ฟเวอร์ และ พี โอ เอส', 'SHA-256': 'เอส เอช เอ สอง ห้า หก',
    'Retail Local': 'รีเทล โลคัล', 'Server': 'เซิร์ฟเวอร์', 'Activate': 'แอ็กทิเวต',
    'License': 'ไลเซนส์', 'Trial': 'ไทรอัล', 'Paid': 'เพด', 'Code': 'โค้ด',
    'backup': 'แบ็กอัป', 'restore': 'รีสโตร์', 'USB': 'ยู เอส บี', 'NAS': 'แนส',
    'macOS': 'แม็ก โอ เอส', 'LIC-': 'แอล ไอ ซี',
})
model = Path(args.model_dir)
for name, digest in model_hashes.items():
    if hashlib.sha256((model / name).read_bytes()).hexdigest() != digest:
        raise RuntimeError(f'Model checksum mismatch: {name}')
steps = json.loads((root / 'apps/web/components/retail-local/guide-flow.json').read_text(encoding='utf-8'))
spoken = [normalize(step['th']['speech']) for step in steps]
checkpoint = root / '.test-output/retail-local-audio-checkpoint.json'
previous = json.loads(checkpoint.read_text(encoding='utf-8')) if checkpoint.exists() else {}
tts = TTS(model / 'kokoro_thai.onnx', model / 'thai_som.npy', config_path=model / 'config.json', intra_op_threads=2)
clips, decoded_clips = [], []
for i, (step, text) in enumerate(zip(steps, spoken)):
    target = out / f'step-{i+1}.mp3'
    old = previous.get(step['id'])
    if old and old['text'] == step['th']['speech'] and old['spoken'] == text and target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == old['sha256']:
        clip = old
    else:
        started = time.monotonic()
        chunks, chunk = [], ''
        for word in text.split():
            if len(chunk) + len(word) > 90 and chunk:
                chunks.append(chunk)
                chunk = ''
            chunk = (chunk + ' ' + word).strip()
        if chunk:
            chunks.append(chunk)
        parts = []
        for chunk in chunks:
            parts.extend([tts.generate(chunk), np.zeros(2400, dtype=np.float32)])
        audio = np.concatenate(parts)
        peak = float(np.max(np.abs(audio)))
        if not np.isfinite(audio).all() or peak < .01 or len(audio) / 24000 > 90:
            raise RuntimeError(f'Invalid audio: {step["id"]}')
        audio *= min(1, .95 / peak)
        sf.write(str(target), audio, 24000, format='MP3', bitrate_mode='CONSTANT', compression_level=.7)
        decoded, rate = sf.read(target)
        clip = dict(id=step['id'], voice='thai_som', text=step['th']['speech'], spoken=text,
                    duration=round(len(decoded)/rate, 3), sha256=hashlib.sha256(target.read_bytes()).hexdigest())
        previous[step['id']] = clip
        checkpoint.write_text(json.dumps(previous, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'Generated {i+1}/{len(steps)} {step["id"]}: {clip["duration"]:.1f}s in {time.monotonic()-started:.1f}s', flush=True)
    decoded, rate = sf.read(target)
    if rate != 24000 or not np.isfinite(decoded).all() or float(np.max(np.abs(decoded))) < .005:
        raise RuntimeError(f'Invalid decoded clip: {step["id"]}')
    clips.append(clip)
    decoded_clips.append(decoded)
summary = out / 'summary.mp3'
sf.write(str(summary), np.concatenate(decoded_clips), 24000, format='MP3', bitrate_mode='CONSTANT', compression_level=.7)
(out / 'provenance.json').write_text(json.dumps(dict(engine='FastThaiG2P / Thai Kokoro',
    model_hashes=model_hashes, clips=clips, summarySha256=hashlib.sha256(summary.read_bytes()).hexdigest()), ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
(root / 'apps/web/components/retail-local/guide-audio.json').write_text(json.dumps(dict(
    durations=[clip['duration'] for clip in clips], totalDuration=round(sum(clip['duration'] for clip in clips), 3)), indent=2)+'\n', encoding='utf-8')
print(f'Published {len(clips)} chapters and a complete summary.', flush=True)
