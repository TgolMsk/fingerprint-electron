"""Portable path resolution. Local settings are never part of source releases."""
import json
import os
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]

def local_settings():
    file = PROJECT / '.fp-local.json'
    return json.loads(file.read_text(encoding='utf-8')) if file.exists() else {}

def source_root():
    value = os.environ.get('FP_SOURCE_ROOT') or local_settings().get('source')
    if not value: raise ValueError('Set FP_SOURCE_ROOT or pass --source explicitly.')
    return str((PROJECT / value).resolve())

def electron_path():
    override = os.environ.get('FP_DEMO_ELECTRON')
    if override: return str((PROJECT / override).resolve())
    config = PROJECT / 'runtime/current.json'
    current = json.loads(config.read_text(encoding='utf-8')) if config.exists() else {}
    value = os.environ.get('FP_DEMO_ELECTRON') or current.get('executable') or local_settings().get('electron') or 'runtime/electron.exe'
    return str((PROJECT / value).resolve())

def locked_base(name):
    return json.loads((PROJECT/'fp-kernel/build/lock.json').read_text(encoding='utf-8'))['verification'][name]
