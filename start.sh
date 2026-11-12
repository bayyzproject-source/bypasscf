#!/bin/bash
# Credit: Hiyori senpai
# Jalanin server di layar virtual (xvfb) supaya Chromium bisa mode headed
exec xvfb-run -a --server-args="-screen 0 1366x768x24" node server.js
