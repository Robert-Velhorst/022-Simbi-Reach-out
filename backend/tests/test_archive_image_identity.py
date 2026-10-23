"""Synthetic archive identity checks; no Docker daemon or operator data."""
import hashlib
import importlib.util
import io
import json
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("image_identity", ROOT / "scripts/archive_image_identity.py")
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


def fixture(tmp_path, mutation=None, classic=False):
    config = json.dumps({"architecture":"amd64","os":"linux",
                         "rootfs":{"diff_ids":["sha256:" + "a" * 64]}}).encode()
    config_id = "sha256:" + hashlib.sha256(config).hexdigest()
    manifest = json.dumps({"config":{"digest":config_id}}).encode()
    manifest_id = "sha256:" + hashlib.sha256(manifest).hexdigest()
    index = json.dumps({"manifests":[{"digest":manifest_id}]}).encode()
    index_id = "sha256:" + hashlib.sha256(index).hexdigest()
    members = {"blobs/sha256/"+config_id[7:]:config,
               "blobs/sha256/"+manifest_id[7:]:manifest,
               "blobs/sha256/"+index_id[7:]:index,
               "manifest.json":json.dumps([{"Config":"blobs/sha256/"+config_id[7:],
                   "RepoTags":["fictional:ci"],"Layers":[]}]).encode()}
    inspection = [{"Id":config_id if classic else index_id,"RepoTags":["fictional:ci"],
                   "Architecture":"amd64","Os":"linux","RootFS":{"Layers":["sha256:"+"a"*64]}}]
    if mutation == "descriptor":
        members["blobs/sha256/"+manifest_id[7:]] = b'{}'
    elif mutation == "configuration":
        members["blobs/sha256/"+config_id[7:]] = b'{}'
    elif mutation == "filesystem":
        inspection[0]["RootFS"]["Layers"] = ["sha256:"+"b"*64]
    elif mutation == "tag":
        inspection[0]["RepoTags"] = ["another:ci"]
    archive = tmp_path / "image.tar"
    with tarfile.open(archive,"w") as bundle:
        for name,payload in members.items():
            member = tarfile.TarInfo(name)
            member.size=len(payload)
            bundle.addfile(member,io.BytesIO(payload))
    return archive,inspection,config_id


@pytest.mark.parametrize("classic", [False, True])
def test_byte_verified_index_or_classic_configuration_passes(tmp_path, classic):
    archive,inspection,expected = fixture(tmp_path,classic=classic)
    proof = identity.archive_identity(archive,inspection,"fictional:ci")
    assert proof["config_id"] == expected
    assert proof["verified_descriptor_chain"] is True


@pytest.mark.parametrize("mutation", ["descriptor","configuration","filesystem","tag"])
def test_changed_archive_or_inspection_cannot_be_accepted(tmp_path, mutation):
    archive,inspection,_ = fixture(tmp_path,mutation)
    with pytest.raises(ValueError):
        identity.archive_identity(archive,inspection,"fictional:ci")
