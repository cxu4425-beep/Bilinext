@echo off
REM Same launcher, multi-user mode: everyone signs in with their own bilibili
REM account and there is no shared key.
REM
REM A separate file because the difference matters and "remember to type an
REM argument" is exactly the kind of thing that goes wrong -- starting the
REM plain bilinext.cmd by mistake drops everyone's sessions and changes the
REM public address.
"%~dp0bilinext.cmd" multi
