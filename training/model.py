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


class SpeciesDistance(nn.Module):
    """Features [N,768] -> distance to the nearest species centroid [N].

    Features are standardised with the train mean/std; each centroid is the
    mean standardised feature of one species' train photos. The distance is
    Euclidean, divided by sqrt(768) (a root-mean-square per feature), so it
    reads the same whatever the feature width.
    """

    def __init__(self, mean: torch.Tensor, std: torch.Tensor, centroids: torch.Tensor):
        super().__init__()
        self.register_buffer("mean", mean.clone())
        self.register_buffer("std", std.clone())
        self.register_buffer("centroids_t", centroids.t().contiguous())
        self.register_buffer("centroid_sq", (centroids * centroids).sum(1))

    def forward(self, f: torch.Tensor) -> torch.Tensor:
        z = (f - self.mean) / self.std
        sq = (z * z).sum(1, keepdim=True) - 2 * (z @ self.centroids_t) + self.centroid_sq
        return (sq.min(1).values.clamp_min(0) / f.shape[1]).sqrt()


class BirdClassifier(nn.Module):
    """Image [N,3,224,224] -> (Confidences [N,200], Distance [N]), for ONNX export.

    The softmax and the temperature are built in: the head's weights and bias
    are divided by the temperature.
    """

    def __init__(self, backbone: nn.Module, head: nn.Linear, temperature: float, distance: SpeciesDistance):
        super().__init__()
        self.backbone = backbone
        self.head = nn.Linear(head.in_features, head.out_features)
        with torch.no_grad():
            self.head.weight.copy_(head.weight / temperature)
            self.head.bias.copy_(head.bias / temperature)
        self.distance = distance

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        f = features(self.backbone, x)
        return torch.softmax(self.head(f), dim=1), self.distance(f)
