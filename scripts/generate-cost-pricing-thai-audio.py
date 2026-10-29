"""Build public cost/pricing narration with the Restaurant guide's pinned voice."""
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import numpy as np
import soundfile as sf
from fastthaig2p import TTS
from pythainlp.tokenize import word_tokenize
from pythainlp.util import num_to_thaiword

import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--model-dir', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'apps/web/public/audio/cost-pricing/th'
out.mkdir(parents=True, exist_ok=True)
(root / '.test-output').mkdir(exist_ok=True)
source = root / 'scripts/generate-restaurant-thai-audio.py'
# Reuse the exact normalization and model checks, without running its publishing main.
tree = ast.parse(source.read_text())
names = {'vocabulary', 'indices', 'pronunciation', 'model_hashes'}
nodes = [node for node in tree.body if
         (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in node.targets))
         or (isinstance(node, ast.FunctionDef) and node.name == 'normalize')]
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'))
model = Path(args.model_dir)
for name, digest in model_hashes.items():
    assert hashlib.sha256((model / name).read_bytes()).hexdigest() == digest, name
tts = TTS(model / 'kokoro_thai.onnx', model / 'thai_som.npy', config_path=model / 'config.json', intra_op_threads=2)
steps = json.loads((root / 'apps/web/components/marketing/cost-pricing/flow.json').read_text())
clips, provenance = [], []
for i, step in enumerate(steps):
    text = normalize(step['th']['speech'])
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
    assert np.isfinite(audio).all() and peak >= .01 and len(audio) / 24000 < 90
    audio *= min(1, .95 / peak)
    wav = root / '.test-output' / f'cost-pricing-step-{i+1}.wav'
    mp3 = out / f'step-{i+1}.mp3'
    sf.write(wav, audio, 24000)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-ar', '24000', '-ac', '1', '-b:a', '32k', str(mp3)], check=True)
    decoded, rate = sf.read(mp3)
    clips.append(str(mp3))
    provenance.append(dict(step=i+1, voice='thai_som', text=step['th']['speech'], spoken=text,
                           duration=len(decoded)/rate, sha256=hashlib.sha256(mp3.read_bytes()).hexdigest()))
    print(f'Step {i+1}/7 generated, {len(decoded)/rate:.1f}s', flush=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', 'concat:'+'|'.join(clips), '-c', 'copy', str(out/'summary.mp3')], check=True)
(out/'provenance.json').write_text(json.dumps(dict(engine='FastThaiG2P / Thai Kokoro', model_hashes=model_hashes, clips=provenance), ensure_ascii=False, indent=2))
print('Generated seven steps, summary and provenance.', flush=True)
