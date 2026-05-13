// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

#pragma once

// Lightweight, _DEBUG-only tracing for the WinAppSDK Fabric touch / pointer / ScrollView
// pipeline. Emitted via OutputDebugStringA (matches the existing pattern in
// ReactNativeHost.cpp and ReactInstanceWin.cpp). Compiles to a no-op in Release builds
// so there is zero runtime cost on the hot pointer path when not actively diagnosing.
//
// Intended for tracking issue #16047 (touch ScrollView leaves Pressables stuck after
// scroll) and any future investigation of the touch identifier / m_activeTouches
// lifecycle. Capture traces with the VS Output window or DebugView++ while running
// the touchScrollDiagnostic Playground bundle.

#if _DEBUG

#include <cstdio>
#include <debugapi.h>

#define RNW_TOUCH_TRACE(fmt, ...)                                                       \
  do {                                                                                  \
    char _rnwTouchBuf[512];                                                             \
    std::snprintf(_rnwTouchBuf, sizeof(_rnwTouchBuf), "[RNW Touch] " fmt "\n", ##__VA_ARGS__); \
    ::OutputDebugStringA(_rnwTouchBuf);                                                 \
  } while (0)

#else

#define RNW_TOUCH_TRACE(fmt, ...) ((void)0)

#endif
