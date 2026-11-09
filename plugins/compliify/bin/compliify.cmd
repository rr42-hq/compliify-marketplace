@echo off
rem compliify - Windows entry point for the launcher next to it (bin/compliify).
rem cmd.exe and PowerShell do not read the "#!" line of that file: for a command
rem without an extension they ask "which app should open it?". They do find this
rem file (.cmd is in PATHEXT), which runs the very same launcher with node.
node "%~dp0compliify" %*
exit /b %errorlevel%
