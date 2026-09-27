"""Native Lua startup arguments. No desktop automation."""
import re


def direct_command(executable, rom, script, help_text, state=None):
    """Only accept a documented startup flag; never fall back to driving menus."""
    if not re.search(r"(?m)^\s*--script\s", help_text):
        raise RuntimeError("Cette version de mGBA ne propose pas --script. "
                           "ExÃ©cutez scripts\\setup-mgba-windows.ps1 puis relancez player.cmd.")
    command = [str(executable), "--script", str(script)]
    if state is not None:
        if "--savestate" not in help_text:
            raise RuntimeError("Cette version de mGBA ne propose pas --savestate.")
        command.extend(["--savestate", str(state)])
    return command + [str(rom)]

