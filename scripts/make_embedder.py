#!/usr/bin/env python3
"""Derive the image *embedder* used for instance matching from MobileNetV2.

The published MobileNetV2 ONNX model ends in an ImageNet classifier (1001 logits). For
recognising one *specific* object we want the 1280-d pooled feature vector before that
classifier. This script removes the classifier and exposes the pooled features (as
float32) as the output "embedding".

Input : .cache/models/mobilenet-v2.fp16.onnx   (fetched + verified by fetch_models.py)
Output: client/public/models/mobilenet-v2-embed.fp16.onnx
Usage : pip install onnx && python3 scripts/make_embedder.py
"""
import pathlib

import onnx
from onnx import TensorProto, helper

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODELS = ROOT / "client" / "public" / "models"
SRC = ROOT / ".cache" / "models" / "mobilenet-v2.fp16.onnx"
DST = MODELS / "mobilenet-v2-embed.fp16.onnx"
FEATURE = "/mobilenet_v2/Flatten_output_0"

model = onnx.load(SRC)
g = model.graph

# Drop everything after the pooled+flattened features (the classifier Gemm and its Cast).
keep, dropped = [], False
for node in g.node:
    if dropped:
        continue
    keep.append(node)
    if FEATURE in node.output:
        dropped = True
assert dropped, f"{FEATURE} not found in graph"
del g.node[:]
g.node.extend(keep)

# The features are float16 inside the model; expose them as float32.
g.node.append(helper.make_node("Cast", [FEATURE], ["embedding"], to=TensorProto.FLOAT, name="embedding_cast"))
del g.output[:]
g.output.append(helper.make_tensor_value_info("embedding", TensorProto.FLOAT, ["batch_size", 1280]))

# Remove now-unused initializers (classifier weights).
used = {i for n in g.node for i in n.input}
for init in list(g.initializer):
    if init.name not in used:
        g.initializer.remove(init)

onnx.checker.check_model(model)
onnx.save(model, DST)
print(f"wrote {DST.name} ({DST.stat().st_size / 1e6:.1f} MB)")
