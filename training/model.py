"""Frozen DINOv2 ViT-S/14 backbone + a linear head over 200 species.

The image feature is the standard DINOv2 linear-probe feature: the class
token concatenated with the mean of the patch tokens (2 x 384 = 768 values).
"""

from __future__ import annotations

import torch
from torch import nn

from preprocess import SIZE

ARCH = "vit_small_patch14_dinov2.lvd142m"
FEATURES = 768
SPECIES = 200


def build_backbone(pretrained: bool = True) -> nn.Module:
    import timm

    return timm.create_model(ARCH, pretrained=pretrained, num_classes=0, img_size=SIZE).eval()


def features(backbone: nn.Module, x: torch.Tensor) -> torch.Tensor:
    tokens = backbone.forward_features(x)  # [N, 1 + patches, 384], final norm applied
    prefix = backbone.num_prefix_tokens
    return torch.cat([tokens[:, 0], tokens[:, prefix:].mean(1)], dim=1)


class BirdClassifier(nn.Module):
    """Image [N,3,224,224] -> Confidences [N,200] (softmax built in, for ONNX export)."""

    def __init__(self, backbone: nn.Module, head: nn.Linear):
        super().__init__()
        self.backbone, self.head = backbone, head

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.softmax(self.head(features(self.backbone, x)), dim=1)
