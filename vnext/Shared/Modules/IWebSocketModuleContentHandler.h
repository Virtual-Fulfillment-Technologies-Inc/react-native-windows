// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

#pragma once

// React Native Windows
#include <JSValue.h>

// Standard Library
#include <string>
#include <vector>

namespace Microsoft::React {

/// <summary>
/// See https://github.com/facebook/react-native/blob/v0.63.2/React/CoreModules/RCTWebSocketModule.h#L12
/// </summary>
struct IWebSocketModuleContentHandler {
  virtual ~IWebSocketModuleContentHandler() noexcept {}

  /// Returns true if this handler should process messages for the given socket.
  /// Default returns true for backward compatibility; BlobModule overrides to
  /// check whether binaryType='blob' was set for this socket via addWebSocketHandler.
  virtual bool Supports(int64_t /*socketId*/) noexcept {
    return true;
  }

  virtual void ProcessMessage(std::string &&message, winrt::Microsoft::ReactNative::JSValueObject &params) noexcept = 0;

  virtual void ProcessMessage(
      std::vector<uint8_t> &&message,
      winrt::Microsoft::ReactNative::JSValueObject &params) noexcept = 0;
};

} // namespace Microsoft::React
