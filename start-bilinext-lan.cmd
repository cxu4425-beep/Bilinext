@echo off
REM Starts the same server, but listening on every network interface so the
REM phone app (and a phone browser) can reach it.
REM
REM This is a separate file rather than a flag because it is a real change in
REM exposure: anyone on the same Wi-Fi who can reach port 8787 is talking to an
REM instance that is already logged in to your bilibili account. Use it on your
REM own network, not on a cafe's.
"%~dp0start-bilinext.cmd" lan
