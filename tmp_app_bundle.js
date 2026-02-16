__d(function (global, require, _$$_IMPORT_DEFAULT, _$$_IMPORT_ALL, module, exports, _dependencyMap) {
  "use strict";

  var _jsxFileName = "C:\\Users\\Robert\\Desktop\\Visual_Studio_Apps\\VoicePracticeApp\\mobile\\App.tsx",
    _s = $RefreshSig$(),
    _s2 = $RefreshSig$(),
    _s3 = $RefreshSig$(),
    _s4 = $RefreshSig$();
  Object.defineProperty(exports, '__esModule', {
    value: true
  });
  function _interopDefault(e) {
    return e && e.__esModule ? e : {
      default: e
    };
  }
  function _interopNamespace(e) {
    if (e && e.__esModule) return e;
    var n = {};
    if (e) Object.keys(e).forEach(function (k) {
      var d = Object.getOwnPropertyDescriptor(e, k);
      Object.defineProperty(n, k, d.get ? d : {
        enumerable: true,
        get: function () {
          return e[k];
        }
      });
    });
    n.default = e;
    return n;
  }
  Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function () {
      return App;
    }
  });
  var _babelRuntimeHelpersAsyncToGenerator = require(_dependencyMap[0], "@babel/runtime/helpers/asyncToGenerator");
  var _asyncToGenerator = _interopDefault(_babelRuntimeHelpersAsyncToGenerator);
  var _babelRuntimeHelpersToConsumableArray = require(_dependencyMap[1], "@babel/runtime/helpers/toConsumableArray");
  var _toConsumableArray = _interopDefault(_babelRuntimeHelpersToConsumableArray);
  var _babelRuntimeHelpersSlicedToArray = require(_dependencyMap[2], "@babel/runtime/helpers/slicedToArray");
  var _slicedToArray = _interopDefault(_babelRuntimeHelpersSlicedToArray);
  var _react = require(_dependencyMap[3], "react");
  var _expoStatusBar = require(_dependencyMap[4], "expo-status-bar");
  var _expoLinearGradient = require(_dependencyMap[5], "expo-linear-gradient");
  var _expoSpeech = require(_dependencyMap[6], "expo-speech");
  var Speech = _interopNamespace(_expoSpeech);
  var _reactNative = require(_dependencyMap[7], "react-native");
  var _reactNativeSafeAreaContext = require(_dependencyMap[8], "react-native-safe-area-context");
  var _voicepracticeShared = require(_dependencyMap[9], "@voicepractice/shared");
  var _srcDataPreferences = require(_dependencyMap[10], "./src/data/preferences");
  var _srcDataPrompts = require(_dependencyMap[11], "./src/data/prompts");
  var _srcLibApi = require(_dependencyMap[12], "./src/lib/api");
  var _srcLibOpenai = require(_dependencyMap[13], "./src/lib/openai");
  var _srcLibStorage = require(_dependencyMap[14], "./src/lib/storage");
  var _srcScreensScorecardView = require(_dependencyMap[15], "./src/screens/ScorecardView");
  var _srcScreensSimulationScreen = require(_dependencyMap[16], "./src/screens/SimulationScreen");
  var _reactJsxDevRuntime = require(_dependencyMap[17], "react/jsx-dev-runtime");
  var APP_THEME_TOKENS = {
    soft_light: {
      bgTop: "#f8f7f3",
      bgBottom: "#ece9e2",
      panel: "rgba(255, 255, 255, 0.94)",
      border: "rgba(31, 41, 55, 0.18)",
      text: "#1f2937",
      textMuted: "#475467",
      accent: "#1d4ed8",
      danger: "#b42318",
      success: "#067647",
      hint: "#5f6c80",
      ghostButtonBg: "rgba(246, 248, 251, 0.95)",
      menuOverlayBackdrop: "rgba(23, 29, 38, 0.34)",
      menuOverlayCardBg: "rgba(255, 255, 255, 0.99)",
      menuCloseBg: "rgba(242, 246, 252, 0.95)",
      menuItemBg: "rgba(247, 250, 255, 0.95)",
      selectedCardBg: "rgba(227, 238, 255, 0.96)",
      currentPlanCardBg: "rgba(220, 233, 255, 0.98)",
      planBadgeText: "#ffffff",
      inputBg: "rgba(255, 255, 255, 0.95)",
      inlineButtonBg: "rgba(244, 248, 255, 0.95)",
      dropdownBg: "rgba(255, 255, 255, 0.95)",
      dropdownChevron: "#475467",
      dropdownModalBackdrop: "rgba(23, 29, 38, 0.4)",
      dropdownModalCardBg: "rgba(255, 255, 255, 0.99)",
      dropdownOptionBg: "rgba(247, 250, 255, 0.95)",
      dropdownOptionSelectedBg: "rgba(223, 236, 255, 0.98)",
      warningBorder: "rgba(180, 121, 25, 0.45)",
      warningBg: "rgba(255, 242, 219, 0.78)",
      warningText: "#8c5300",
      errorCardBorder: "rgba(180, 35, 24, 0.4)",
      errorCardBg: "rgba(255, 234, 230, 0.82)",
      linkButtonBg: "rgba(246, 249, 255, 0.95)",
      primaryButtonText: "#ffffff"
    },
    classic_blue: {
      bgTop: "#071225",
      bgBottom: "#16365d",
      panel: "rgba(17, 37, 64, 0.84)",
      border: "rgba(143, 183, 232, 0.28)",
      text: "#eaf2ff",
      textMuted: "#9eb6d5",
      accent: "#35c2ff",
      danger: "#ff7c7c",
      success: "#78e5b8",
      hint: "#8fb4e5",
      ghostButtonBg: "rgba(18, 40, 70, 0.5)",
      menuOverlayBackdrop: "rgba(5, 10, 18, 0.58)",
      menuOverlayCardBg: "rgba(10, 30, 55, 0.97)",
      menuCloseBg: "rgba(17, 39, 65, 0.9)",
      menuItemBg: "rgba(19, 45, 74, 0.7)",
      selectedCardBg: "rgba(25, 59, 99, 0.9)",
      currentPlanCardBg: "rgba(21, 56, 92, 0.92)",
      planBadgeText: "#062235",
      inputBg: "rgba(8, 26, 44, 0.8)",
      inlineButtonBg: "rgba(20, 44, 72, 0.74)",
      dropdownBg: "rgba(8, 26, 44, 0.8)",
      dropdownChevron: "#9eb6d5",
      dropdownModalBackdrop: "rgba(5, 10, 18, 0.76)",
      dropdownModalCardBg: "rgba(9, 26, 46, 0.98)",
      dropdownOptionBg: "rgba(18, 40, 67, 0.72)",
      dropdownOptionSelectedBg: "rgba(28, 75, 120, 0.95)",
      warningBorder: "rgba(255, 194, 95, 0.5)",
      warningBg: "rgba(69, 49, 14, 0.48)",
      warningText: "#ffc25f",
      errorCardBorder: "rgba(255, 124, 124, 0.52)",
      errorCardBg: "rgba(79, 24, 24, 0.55)",
      linkButtonBg: "rgba(18, 42, 72, 0.66)",
      primaryButtonText: "#062235"
    }
  };
  function getErrorMessage(error, fallback) {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    return fallback;
  }
  function isEmailLike(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  function fallbackScorecard(history) {
    var userTurns = history.filter(function (message) {
      return message.role === "user";
    }).length;
    if (userTurns === 0) {
      return {
        overallScore: 0,
        persuasion: 1,
        clarity: 1,
        empathy: 1,
        assertiveness: 1,
        strengths: ["Session started successfully."],
        improvements: ["Speak at least once before ending the session.", "Use clearer and more direct points.", "Address objections with examples."],
        summary: "No user voice response was captured, so scoring is limited."
      };
    }
    var base = Math.min(100, 45 + userTurns * 8);
    return {
      overallScore: base,
      persuasion: Math.min(10, 3 + userTurns),
      clarity: Math.min(10, 3 + Math.floor(userTurns / 2)),
      empathy: Math.min(10, 2 + Math.floor(userTurns / 2)),
      assertiveness: Math.min(10, 3 + Math.floor(userTurns / 2)),
      strengths: ["Stayed engaged through the conversation.", "Kept responses focused on the scenario.", "Maintained steady communication tone."],
      improvements: ["Use more evidence to support key points.", "Summarize agreements and next steps.", "Address concerns with tighter framing."],
      summary: "Fallback scoring applied. Keep refining persuasive structure and evidence."
    };
  }
  function dedupeTimezones(list) {
    return Array.from(new Set(list));
  }
  function resolveDeviceTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (_unused) {
      return "UTC";
    }
  }
  function formatDateLabel(value) {
    if (!value) {
      return "N/A";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }
  function TimezoneDropdown(_ref) {
    var _this = this;
    _s();
    var value = _ref.value,
      options = _ref.options,
      onChange = _ref.onChange,
      _ref$placeholder = _ref.placeholder,
      placeholder = _ref$placeholder === void 0 ? "Select timezone" : _ref$placeholder,
      styles = _ref.styles;
    var _useState = (0, _react.useState)(false),
      _useState2 = (0, _slicedToArray.default)(_useState, 2),
      isOpen = _useState2[0],
      setIsOpen = _useState2[1];
    var selectedLabel = value.trim() ? value : placeholder;
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
      style: styles.dropdownWrapper,
      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
        style: styles.dropdownTrigger,
        onPress: function onPress() {
          return setIsOpen(true);
        },
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: styles.dropdownValue,
          numberOfLines: 1,
          children: selectedLabel
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 322,
          columnNumber: 9
        }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: styles.dropdownChevron,
          children: "v"
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 325,
          columnNumber: 9
        }, this)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 321,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Modal, {
        transparent: true,
        visible: isOpen,
        animationType: "fade",
        onRequestClose: function onRequestClose() {
          return setIsOpen(false);
        },
        children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.dropdownModalRoot,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.dropdownModalBackdrop,
            onPress: function onPress() {
              return setIsOpen(false);
            }
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 329,
            columnNumber: 11
          }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.dropdownModalCard,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.dropdownModalTitle,
              children: "Select Timezone"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 331,
              columnNumber: 13
            }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
              style: styles.dropdownOptionsScroll,
              contentContainerStyle: styles.dropdownOptionsContent,
              children: options.map(function (timezone) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: [styles.dropdownOption, value === timezone ? styles.dropdownOptionSelected : null],
                  onPress: function onPress() {
                    onChange(timezone);
                    setIsOpen(false);
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: [styles.dropdownOptionText, value === timezone ? styles.dropdownOptionTextSelected : null],
                    children: timezone
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 342,
                    columnNumber: 19
                  }, _this)
                }, timezone, false, {
                  fileName: _jsxFileName,
                  lineNumber: 334,
                  columnNumber: 17
                }, _this);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 332,
              columnNumber: 13
            }, this)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 330,
            columnNumber: 11
          }, this)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 328,
          columnNumber: 9
        }, this)
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 327,
        columnNumber: 7
      }, this)]
    }, void 0, true, {
      fileName: _jsxFileName,
      lineNumber: 320,
      columnNumber: 5
    }, this);
  }
  _s(TimezoneDropdown, "+sus0Lb0ewKHdwiUhiTAJFoFyQ0=");
  _c = TimezoneDropdown;
  function SelectionDropdown(_ref2) {
    var _ref3,
      _selected$label,
      _this2 = this;
    _s2();
    var value = _ref2.value,
      options = _ref2.options,
      onChange = _ref2.onChange,
      placeholder = _ref2.placeholder,
      title = _ref2.title,
      styles = _ref2.styles;
    var _useState3 = (0, _react.useState)(false),
      _useState4 = (0, _slicedToArray.default)(_useState3, 2),
      isOpen = _useState4[0],
      setIsOpen = _useState4[1];
    var selected = options.find(function (option) {
      return option.value === value;
    });
    var selectedLabel = (_ref3 = (_selected$label = selected == null ? void 0 : selected.label) != null ? _selected$label : placeholder) != null ? _ref3 : `Select ${title.toLowerCase()}`;
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
      style: styles.dropdownWrapper,
      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
        style: styles.dropdownTrigger,
        onPress: function onPress() {
          return setIsOpen(true);
        },
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: styles.dropdownValue,
          numberOfLines: 1,
          children: selectedLabel
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 384,
          columnNumber: 9
        }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: styles.dropdownChevron,
          children: "v"
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 387,
          columnNumber: 9
        }, this)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 383,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Modal, {
        transparent: true,
        visible: isOpen,
        animationType: "fade",
        onRequestClose: function onRequestClose() {
          return setIsOpen(false);
        },
        children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.dropdownModalRoot,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.dropdownModalBackdrop,
            onPress: function onPress() {
              return setIsOpen(false);
            }
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 391,
            columnNumber: 11
          }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.dropdownModalCard,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.dropdownModalTitle,
              children: ["Select ", title]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 393,
              columnNumber: 13
            }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
              style: styles.dropdownOptionsScroll,
              contentContainerStyle: styles.dropdownOptionsContent,
              children: options.map(function (option) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: [styles.dropdownOption, value === option.value ? styles.dropdownOptionSelected : null],
                  onPress: function onPress() {
                    onChange(option.value);
                    setIsOpen(false);
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: [styles.dropdownOptionText, value === option.value ? styles.dropdownOptionTextSelected : null],
                    children: option.label
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 404,
                    columnNumber: 19
                  }, _this2)
                }, option.value, false, {
                  fileName: _jsxFileName,
                  lineNumber: 396,
                  columnNumber: 17
                }, _this2);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 394,
              columnNumber: 13
            }, this)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 392,
            columnNumber: 11
          }, this)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 390,
          columnNumber: 9
        }, this)
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 389,
        columnNumber: 7
      }, this)]
    }, void 0, true, {
      fileName: _jsxFileName,
      lineNumber: 382,
      columnNumber: 5
    }, this);
  }
  _s2(SelectionDropdown, "+sus0Lb0ewKHdwiUhiTAJFoFyQ0=");
  _c2 = SelectionDropdown;
  function SearchableSelectionDropdown(_ref4) {
    var _ref5,
      _selected$label2,
      _this3 = this;
    _s3();
    var value = _ref4.value,
      options = _ref4.options,
      onChange = _ref4.onChange,
      placeholder = _ref4.placeholder,
      title = _ref4.title,
      searchPlaceholder = _ref4.searchPlaceholder,
      styles = _ref4.styles;
    var _useState5 = (0, _react.useState)(false),
      _useState6 = (0, _slicedToArray.default)(_useState5, 2),
      isOpen = _useState6[0],
      setIsOpen = _useState6[1];
    var _useState7 = (0, _react.useState)(""),
      _useState8 = (0, _slicedToArray.default)(_useState7, 2),
      query = _useState8[0],
      setQuery = _useState8[1];
    var selected = options.find(function (option) {
      return option.value === value;
    });
    var selectedLabel = (_ref5 = (_selected$label2 = selected == null ? void 0 : selected.label) != null ? _selected$label2 : placeholder) != null ? _ref5 : `Select ${title.toLowerCase()}`;
    var filtered = (0, _react.useMemo)(function () {
      var needle = query.trim().toLowerCase();
      if (!needle) {
        return options;
      }
      return options.filter(function (option) {
        return option.label.toLowerCase().includes(needle);
      });
    }, [options, query]);
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
      style: styles.dropdownWrapper,
      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
        style: styles.dropdownTrigger,
        onPress: function onPress() {
          setQuery("");
          setIsOpen(true);
        },
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: styles.dropdownValue,
          numberOfLines: 1,
          children: selectedLabel
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 463,
          columnNumber: 9
        }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: styles.dropdownChevron,
          children: "v"
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 466,
          columnNumber: 9
        }, this)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 456,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Modal, {
        transparent: true,
        visible: isOpen,
        animationType: "fade",
        onRequestClose: function onRequestClose() {
          setIsOpen(false);
        },
        children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.KeyboardAvoidingView, {
          style: styles.dropdownModalRoot,
          behavior: _reactNative.Platform.OS === "ios" ? "padding" : undefined,
          keyboardVerticalOffset: 24,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.dropdownModalBackdrop,
            onPress: function onPress() {
              return setIsOpen(false);
            }
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 481,
            columnNumber: 11
          }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.dropdownModalCard,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.dropdownModalTitle,
              children: ["Select ", title]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 483,
              columnNumber: 13
            }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TextInput, {
              style: styles.input,
              value: query,
              onChangeText: setQuery,
              placeholder: searchPlaceholder != null ? searchPlaceholder : `Search ${title.toLowerCase()}...`,
              placeholderTextColor: "#667085",
              autoCapitalize: "none",
              autoCorrect: false
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 484,
              columnNumber: 13
            }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
              style: styles.dropdownOptionsScroll,
              contentContainerStyle: styles.dropdownOptionsContent,
              children: filtered.length === 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "(No matches.)"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 495,
                columnNumber: 17
              }, this) : filtered.map(function (option) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: [styles.dropdownOption, value === option.value ? styles.dropdownOptionSelected : null],
                  onPress: function onPress() {
                    onChange(option.value);
                    setIsOpen(false);
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: [styles.dropdownOptionText, value === option.value ? styles.dropdownOptionTextSelected : null],
                    children: option.label
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 506,
                    columnNumber: 21
                  }, _this3)
                }, option.value, false, {
                  fileName: _jsxFileName,
                  lineNumber: 498,
                  columnNumber: 19
                }, _this3);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 493,
              columnNumber: 13
            }, this)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 482,
            columnNumber: 11
          }, this)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 476,
          columnNumber: 9
        }, this)
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 468,
        columnNumber: 7
      }, this)]
    }, void 0, true, {
      fileName: _jsxFileName,
      lineNumber: 455,
      columnNumber: 5
    }, this);
  }
  _s3(SearchableSelectionDropdown, "9h7SZjrxgFq17I1AvOpMGsCC0sU=");
  _c3 = SearchableSelectionDropdown;
  function App() {
    var _this4 = this;
    _s4();
    var detectedTimezone = (0, _react.useMemo)(function () {
      return resolveDeviceTimezone();
    }, []);
    var _useState9 = (0, _react.useState)("home"),
      _useState0 = (0, _slicedToArray.default)(_useState9, 2),
      screen = _useState0[0],
      setScreen = _useState0[1];
    var _useState1 = (0, _react.useState)("soft_light"),
      _useState10 = (0, _slicedToArray.default)(_useState1, 2),
      colorScheme = _useState10[0],
      setColorScheme = _useState10[1];
    var _useState11 = (0, _react.useState)("balanced"),
      _useState12 = (0, _slicedToArray.default)(_useState11, 2),
      voiceProfile = _useState12[0],
      setVoiceProfile = _useState12[1];
    var _useState13 = (0, _react.useState)("female"),
      _useState14 = (0, _slicedToArray.default)(_useState13, 2),
      voiceGender = _useState14[0],
      setVoiceGender = _useState14[1];
    var _useState15 = (0, _react.useState)(false),
      _useState16 = (0, _slicedToArray.default)(_useState15, 2),
      isVoiceSamplePlaying = _useState16[0],
      setIsVoiceSamplePlaying = _useState16[1];
    var _useState17 = (0, _react.useState)(false),
      _useState18 = (0, _slicedToArray.default)(_useState17, 2),
      isHomeMenuOpen = _useState18[0],
      setIsHomeMenuOpen = _useState18[1];
    var _useState19 = (0, _react.useState)(false),
      _useState20 = (0, _slicedToArray.default)(_useState19, 2),
      isHomeMenuMounted = _useState20[0],
      setIsHomeMenuMounted = _useState20[1];
    var homeMenuSlide = (0, _react.useRef)(new _reactNative.Animated.Value(0)).current;
    var mobileUpdatesCursorRef = (0, _react.useRef)(0);
    var _useState21 = (0, _react.useState)(true),
      _useState22 = (0, _slicedToArray.default)(_useState21, 2),
      isBootLoading = _useState22[0],
      setIsBootLoading = _useState22[1];
    var _useState23 = (0, _react.useState)(null),
      _useState24 = (0, _slicedToArray.default)(_useState23, 2),
      appError = _useState24[0],
      setAppError = _useState24[1];
    var _useState25 = (0, _react.useState)(null),
      _useState26 = (0, _slicedToArray.default)(_useState25, 2),
      setupError = _useState26[0],
      setSetupError = _useState26[1];
    var _useState27 = (0, _react.useState)(null),
      _useState28 = (0, _slicedToArray.default)(_useState27, 2),
      config = _useState28[0],
      setConfig = _useState28[1];
    var _useState29 = (0, _react.useState)(_voicepracticeShared.COMMON_TIMEZONES),
      _useState30 = (0, _slicedToArray.default)(_useState29, 2),
      timezones = _useState30[0],
      setTimezones = _useState30[1];
    var _useState31 = (0, _react.useState)(null),
      _useState32 = (0, _slicedToArray.default)(_useState31, 2),
      user = _useState32[0],
      setUser = _useState32[1];
    var _useState33 = (0, _react.useState)(null),
      _useState34 = (0, _slicedToArray.default)(_useState33, 2),
      mobileAuthToken = _useState34[0],
      setMobileAuthToken = _useState34[1];
    var _useState35 = (0, _react.useState)(null),
      _useState36 = (0, _slicedToArray.default)(_useState35, 2),
      entitlements = _useState36[0],
      setEntitlements = _useState36[1];
    var _useState37 = (0, _react.useState)(""),
      _useState38 = (0, _slicedToArray.default)(_useState37, 2),
      selectedIndustryId = _useState38[0],
      setSelectedIndustryId = _useState38[1];
    var _useState39 = (0, _react.useState)(""),
      _useState40 = (0, _slicedToArray.default)(_useState39, 2),
      selectedRoleId = _useState40[0],
      setSelectedRoleId = _useState40[1];
    var _useState41 = (0, _react.useState)(""),
      _useState42 = (0, _slicedToArray.default)(_useState41, 2),
      selectedScenarioId = _useState42[0],
      setSelectedScenarioId = _useState42[1];
    var _useState43 = (0, _react.useState)("medium"),
      _useState44 = (0, _slicedToArray.default)(_useState43, 2),
      selectedDifficulty = _useState44[0],
      setSelectedDifficulty = _useState44[1];
    var _useState45 = (0, _react.useState)("skeptical"),
      _useState46 = (0, _slicedToArray.default)(_useState45, 2),
      selectedPersonaStyle = _useState46[0],
      setSelectedPersonaStyle = _useState46[1];
    var _useState47 = (0, _react.useState)(""),
      _useState48 = (0, _slicedToArray.default)(_useState47, 2),
      onboardingEmail = _useState48[0],
      setOnboardingEmail = _useState48[1];
    var _useState49 = (0, _react.useState)(detectedTimezone),
      _useState50 = (0, _slicedToArray.default)(_useState49, 2),
      onboardingTimezone = _useState50[0],
      setOnboardingTimezone = _useState50[1];
    var _useState51 = (0, _react.useState)(null),
      _useState52 = (0, _slicedToArray.default)(_useState51, 2),
      onboardingError = _useState52[0],
      setOnboardingError = _useState52[1];
    var _useState53 = (0, _react.useState)(false),
      _useState54 = (0, _slicedToArray.default)(_useState53, 2),
      isOnboardingSaving = _useState54[0],
      setIsOnboardingSaving = _useState54[1];
    var _useState55 = (0, _react.useState)(""),
      _useState56 = (0, _slicedToArray.default)(_useState55, 2),
      settingsEmail = _useState56[0],
      setSettingsEmail = _useState56[1];
    var _useState57 = (0, _react.useState)(detectedTimezone),
      _useState58 = (0, _slicedToArray.default)(_useState57, 2),
      settingsTimezone = _useState58[0],
      setSettingsTimezone = _useState58[1];
    var _useState59 = (0, _react.useState)(null),
      _useState60 = (0, _slicedToArray.default)(_useState59, 2),
      settingsNotice = _useState60[0],
      setSettingsNotice = _useState60[1];
    var _useState61 = (0, _react.useState)(null),
      _useState62 = (0, _slicedToArray.default)(_useState61, 2),
      settingsError = _useState62[0],
      setSettingsError = _useState62[1];
    var _useState63 = (0, _react.useState)(false),
      _useState64 = (0, _slicedToArray.default)(_useState63, 2),
      isSettingsSaving = _useState64[0],
      setIsSettingsSaving = _useState64[1];
    var _useState65 = (0, _react.useState)(null),
      _useState66 = (0, _slicedToArray.default)(_useState65, 2),
      simulationConfig = _useState66[0],
      setSimulationConfig = _useState66[1];
    var _useState67 = (0, _react.useState)(null),
      _useState68 = (0, _slicedToArray.default)(_useState67, 2),
      lastCompletedConfig = _useState68[0],
      setLastCompletedConfig = _useState68[1];
    var _useState69 = (0, _react.useState)(null),
      _useState70 = (0, _slicedToArray.default)(_useState69, 2),
      scorecard = _useState70[0],
      setScorecard = _useState70[1];
    var _useState71 = (0, _react.useState)(null),
      _useState72 = (0, _slicedToArray.default)(_useState71, 2),
      scorecardError = _useState72[0],
      setScorecardError = _useState72[1];
    var _useState73 = (0, _react.useState)(false),
      _useState74 = (0, _slicedToArray.default)(_useState73, 2),
      isScoring = _useState74[0],
      setIsScoring = _useState74[1];
    var _useState75 = (0, _react.useState)(30),
      _useState76 = (0, _slicedToArray.default)(_useState75, 2),
      dashboardDays = _useState76[0],
      setDashboardDays = _useState76[1];
    var _useState77 = (0, _react.useState)(""),
      _useState78 = (0, _slicedToArray.default)(_useState77, 2),
      dashboardSegmentId = _useState78[0],
      setDashboardSegmentId = _useState78[1];
    var _useState79 = (0, _react.useState)(null),
      _useState80 = (0, _slicedToArray.default)(_useState79, 2),
      scoreSummary = _useState80[0],
      setScoreSummary = _useState80[1];
    var _useState81 = (0, _react.useState)(null),
      _useState82 = (0, _slicedToArray.default)(_useState81, 2),
      dashboardError = _useState82[0],
      setDashboardError = _useState82[1];
    var _useState83 = (0, _react.useState)(false),
      _useState84 = (0, _slicedToArray.default)(_useState83, 2),
      dashboardLoading = _useState84[0],
      setDashboardLoading = _useState84[1];
    var _useState85 = (0, _react.useState)(30),
      _useState86 = (0, _slicedToArray.default)(_useState85, 2),
      adminRangeDays = _useState86[0],
      setAdminRangeDays = _useState86[1];
    var _useState87 = (0, _react.useState)(null),
      _useState88 = (0, _slicedToArray.default)(_useState87, 2),
      orgAdminDashboard = _useState88[0],
      setOrgAdminDashboard = _useState88[1];
    var _useState89 = (0, _react.useState)(null),
      _useState90 = (0, _slicedToArray.default)(_useState89, 2),
      orgAdminAnalytics = _useState90[0],
      setOrgAdminAnalytics = _useState90[1];
    var _useState91 = (0, _react.useState)(null),
      _useState92 = (0, _slicedToArray.default)(_useState91, 2),
      orgAdminUsers = _useState92[0],
      setOrgAdminUsers = _useState92[1];
    var _useState93 = (0, _react.useState)("active"),
      _useState94 = (0, _slicedToArray.default)(_useState93, 2),
      adminUserStatusFilter = _useState94[0],
      setAdminUserStatusFilter = _useState94[1];
    var _useState95 = (0, _react.useState)(""),
      _useState96 = (0, _slicedToArray.default)(_useState95, 2),
      selectedAdminUserId = _useState96[0],
      setSelectedAdminUserId = _useState96[1];
    var _useState97 = (0, _react.useState)(null),
      _useState98 = (0, _slicedToArray.default)(_useState97, 2),
      orgAdminUserDetail = _useState98[0],
      setOrgAdminUserDetail = _useState98[1];
    var _useState99 = (0, _react.useState)(false),
      _useState100 = (0, _slicedToArray.default)(_useState99, 2),
      adminLoading = _useState100[0],
      setAdminLoading = _useState100[1];
    var _useState101 = (0, _react.useState)(null),
      _useState102 = (0, _slicedToArray.default)(_useState101, 2),
      adminError = _useState102[0],
      setAdminError = _useState102[1];
    var apiConfigured = (0, _react.useMemo)(function () {
      return (0, _srcLibOpenai.isOpenAiConfigured)();
    }, []);
    var enabledSegments = (0, _react.useMemo)(function () {
      var _config$segments$filt, _config$segments;
      return (_config$segments$filt = config == null || (_config$segments = config.segments) == null ? void 0 : _config$segments.filter(function (segment) {
        return segment.enabled;
      })) != null ? _config$segments$filt : [];
    }, [config]);
    var industryOptions = (0, _react.useMemo)(function () {
      return _voicepracticeShared.INDUSTRY_IDS.map(function (industryId) {
        return {
          id: industryId,
          label: _voicepracticeShared.INDUSTRY_LABELS[industryId],
          roles: _voicepracticeShared.INDUSTRY_ROLE_SEGMENT_IDS[industryId].map(function (segmentId) {
            return enabledSegments.find(function (segment) {
              return segment.id === segmentId;
            });
          }).filter(function (segment) {
            return Boolean(segment);
          })
        };
      }).filter(function (industry) {
        return industry.roles.length > 0;
      });
    }, [enabledSegments]);
    var activeIndustry = (0, _react.useMemo)(function () {
      var _industryOptions$find;
      if (industryOptions.length === 0) {
        return null;
      }
      return (_industryOptions$find = industryOptions.find(function (industry) {
        return industry.id === selectedIndustryId;
      })) != null ? _industryOptions$find : industryOptions[0];
    }, [industryOptions, selectedIndustryId]);
    var roleOptions = (0, _react.useMemo)(function () {
      var _activeIndustry$roles;
      return (_activeIndustry$roles = activeIndustry == null ? void 0 : activeIndustry.roles) != null ? _activeIndustry$roles : [];
    }, [activeIndustry]);
    var activeSegment = (0, _react.useMemo)(function () {
      var _roleOptions$find;
      if (roleOptions.length === 0) {
        return null;
      }
      return (_roleOptions$find = roleOptions.find(function (segment) {
        return segment.id === selectedRoleId;
      })) != null ? _roleOptions$find : roleOptions[0];
    }, [roleOptions, selectedRoleId]);
    var activeScenarios = (0, _react.useMemo)(function () {
      if (!activeSegment) {
        return [];
      }
      return activeSegment.scenarios.filter(function (scenario) {
        return scenario.enabled !== false;
      });
    }, [activeSegment]);
    var activeScenario = (0, _react.useMemo)(function () {
      var _activeScenarios$find;
      if (activeScenarios.length === 0) {
        return null;
      }
      return (_activeScenarios$find = activeScenarios.find(function (scenario) {
        return scenario.id === selectedScenarioId;
      })) != null ? _activeScenarios$find : activeScenarios[0];
    }, [activeScenarios, selectedScenarioId]);
    var mergedTimezones = (0, _react.useMemo)(function () {
      return dedupeTimezones([detectedTimezone].concat((0, _toConsumableArray.default)(_voicepracticeShared.COMMON_TIMEZONES), (0, _toConsumableArray.default)(timezones)));
    }, [detectedTimezone, timezones]);
    var theme = (0, _react.useMemo)(function () {
      return APP_THEME_TOKENS[colorScheme];
    }, [colorScheme]);
    var styles = (0, _react.useMemo)(function () {
      return createStyles(theme);
    }, [theme]);
    var statusBarStyle = colorScheme === "soft_light" ? "dark" : "light";
    var selectedVoiceOption = (0, _react.useMemo)(function () {
      return (0, _srcDataPreferences.getAiVoiceOption)(voiceProfile);
    }, [voiceProfile]);
    var industrySelectOptions = (0, _react.useMemo)(function () {
      return industryOptions.map(function (industry) {
        return {
          value: industry.id,
          label: industry.label
        };
      });
    }, [industryOptions]);
    var roleSelectOptions = (0, _react.useMemo)(function () {
      return roleOptions.map(function (role) {
        return {
          value: role.id,
          label: role.label
        };
      });
    }, [roleOptions]);
    var scenarioSelectOptions = (0, _react.useMemo)(function () {
      return activeScenarios.map(function (scenario) {
        return {
          value: scenario.id,
          label: scenario.title
        };
      });
    }, [activeScenarios]);
    var dashboardSegmentSelectOptions = (0, _react.useMemo)(function () {
      return enabledSegments.map(function (segment) {
        return {
          value: segment.id,
          label: segment.label
        };
      }).sort(function (a, b) {
        return a.label.localeCompare(b.label);
      });
    }, [enabledSegments]);
    var segmentLabelById = (0, _react.useMemo)(function () {
      var map = new Map();
      for (var segment of enabledSegments) {
        map.set(segment.id, segment.label);
      }
      return map;
    }, [enabledSegments]);
    var scenarioTitleById = (0, _react.useMemo)(function () {
      var map = new Map();
      for (var segment of enabledSegments) {
        for (var scenario of segment.scenarios) {
          map.set(scenario.id, scenario.title);
        }
      }
      return map;
    }, [enabledSegments]);
    var industryIdByRoleSegmentId = (0, _react.useMemo)(function () {
      var map = new Map();
      for (var industryId of _voicepracticeShared.INDUSTRY_IDS) {
        var _INDUSTRY_ROLE_SEGMEN;
        var roleIds = (_INDUSTRY_ROLE_SEGMEN = _voicepracticeShared.INDUSTRY_ROLE_SEGMENT_IDS[industryId]) != null ? _INDUSTRY_ROLE_SEGMEN : [];
        for (var roleId of roleIds) {
          map.set(roleId, industryId);
        }
      }
      return map;
    }, []);
    var openHomeMenu = (0, _react.useCallback)(function () {
      if (isHomeMenuMounted) {
        return;
      }
      setIsHomeMenuMounted(true);
      setIsHomeMenuOpen(true);
      homeMenuSlide.setValue(0);
      _reactNative.Animated.timing(homeMenuSlide, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true
      }).start();
    }, [homeMenuSlide, isHomeMenuMounted]);
    var closeHomeMenu = (0, _react.useCallback)(function (nextScreen) {
      if (!isHomeMenuMounted) {
        setIsHomeMenuOpen(false);
        if (nextScreen) {
          setScreen(nextScreen);
        }
        return;
      }
      _reactNative.Animated.timing(homeMenuSlide, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true
      }).start(function () {
        setIsHomeMenuMounted(false);
        setIsHomeMenuOpen(false);
        if (nextScreen) {
          setScreen(nextScreen);
        }
      });
    }, [homeMenuSlide, isHomeMenuMounted]);
    var refreshScoreDashboard = (0, _react.useCallback)(/*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
      if (!user || !mobileAuthToken) {
        return;
      }
      setDashboardLoading(true);
      setDashboardError(null);
      try {
        var payload = yield (0, _srcLibApi.fetchScoreSummary)(user.id, mobileAuthToken, {
          days: dashboardDays,
          segmentId: dashboardSegmentId.trim() ? dashboardSegmentId.trim() : undefined
        });
        setScoreSummary(payload);
      } catch (caught) {
        setDashboardError(getErrorMessage(caught, "Could not load dashboard stats."));
      } finally {
        setDashboardLoading(false);
      }
    }), [dashboardDays, dashboardSegmentId, mobileAuthToken, user]);
    var refreshOrgAdminDashboard = (0, _react.useCallback)(/*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
      if (!user || !mobileAuthToken) {
        return;
      }
      var actorIsOrgAdmin = user.accountType === "enterprise" && user.orgRole === "org_admin";
      if (!actorIsOrgAdmin) {
        setAdminError("Org admin access required.");
        return;
      }
      setAdminLoading(true);
      setAdminError(null);
      try {
        var _yield$Promise$all = yield Promise.all([(0, _srcLibApi.fetchOrgAdminDashboard)(user.id, mobileAuthToken), (0, _srcLibApi.fetchOrgAdminAnalytics)(user.id, mobileAuthToken, {
            days: adminRangeDays
          })]),
          _yield$Promise$all2 = (0, _slicedToArray.default)(_yield$Promise$all, 2),
          dashboardPayload = _yield$Promise$all2[0],
          analyticsPayload = _yield$Promise$all2[1];
        setOrgAdminDashboard(dashboardPayload);
        setOrgAdminAnalytics(analyticsPayload);
      } catch (caught) {
        setAdminError(getErrorMessage(caught, "Could not load org admin dashboard."));
      } finally {
        setAdminLoading(false);
      }
    }), [adminRangeDays, mobileAuthToken, user]);
    var refreshOrgAdminUsers = (0, _react.useCallback)(/*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
      if (!user || !mobileAuthToken) {
        return;
      }
      var actorHasAdminAccess = user.accountType === "enterprise" && (user.orgRole === "org_admin" || user.orgRole === "user_admin");
      if (!actorHasAdminAccess) {
        setAdminError("Admin access required.");
        return;
      }
      setAdminLoading(true);
      setAdminError(null);
      try {
        var payload = yield (0, _srcLibApi.fetchOrgAdminUsers)(user.id, mobileAuthToken);
        setOrgAdminUsers(payload);
      } catch (caught) {
        setAdminError(getErrorMessage(caught, "Could not load organization users."));
      } finally {
        setAdminLoading(false);
      }
    }), [mobileAuthToken, user]);
    var refreshOrgAdminUserDetail = (0, _react.useCallback)(/*#__PURE__*/function () {
      var _ref9 = (0, _asyncToGenerator.default)(function* (targetUserId) {
        if (!user || !mobileAuthToken) {
          return;
        }
        var actorHasAdminAccess = user.accountType === "enterprise" && (user.orgRole === "org_admin" || user.orgRole === "user_admin");
        if (!actorHasAdminAccess) {
          setAdminError("Admin access required.");
          return;
        }
        setAdminLoading(true);
        setAdminError(null);
        try {
          var payload = yield (0, _srcLibApi.fetchOrgAdminUserDetail)(user.id, targetUserId, mobileAuthToken, {
            days: 30
          });
          setOrgAdminUserDetail(payload);
        } catch (caught) {
          setAdminError(getErrorMessage(caught, "Could not load user details."));
        } finally {
          setAdminLoading(false);
        }
      });
      return function (_x) {
        return _ref9.apply(this, arguments);
      };
    }(), [mobileAuthToken, user]);
    var setOrgUserLocked = (0, _react.useCallback)(/*#__PURE__*/function () {
      var _ref0 = (0, _asyncToGenerator.default)(function* (targetUserId, locked) {
        if (!user || !mobileAuthToken) {
          return;
        }
        var actorHasAdminAccess = user.accountType === "enterprise" && (user.orgRole === "org_admin" || user.orgRole === "user_admin");
        if (!actorHasAdminAccess) {
          setAdminError("Admin access required.");
          return;
        }
        setAdminLoading(true);
        setAdminError(null);
        try {
          yield (0, _srcLibApi.setOrgAdminUserStatus)(user.id, targetUserId, mobileAuthToken, locked ? "disabled" : "active");
          yield Promise.all([refreshOrgAdminUsers(), refreshOrgAdminUserDetail(targetUserId)]);
        } catch (caught) {
          setAdminError(getErrorMessage(caught, "Could not update user status."));
        } finally {
          setAdminLoading(false);
        }
      });
      return function (_x2, _x3) {
        return _ref0.apply(this, arguments);
      };
    }(), [mobileAuthToken, refreshOrgAdminUserDetail, refreshOrgAdminUsers, user]);
    (0, _react.useEffect)(function () {
      if (screen !== "home" && isHomeMenuMounted) {
        homeMenuSlide.setValue(0);
        setIsHomeMenuMounted(false);
        setIsHomeMenuOpen(false);
      }
    }, [homeMenuSlide, isHomeMenuMounted, screen]);
    (0, _react.useEffect)(function () {
      if (screen !== "usage_dashboard") {
        return;
      }
      void refreshScoreDashboard();
    }, [refreshScoreDashboard, screen]);
    (0, _react.useEffect)(function () {
      if (screen === "admin_home" && !orgAdminUsers) {
        void refreshOrgAdminUsers();
      }
      if (screen === "admin_org_dashboard") {
        void refreshOrgAdminDashboard();
      }
      if (screen === "admin_user_list") {
        void refreshOrgAdminUsers();
      }
      if (screen === "admin_user_detail" && selectedAdminUserId.trim()) {
        void refreshOrgAdminUserDetail(selectedAdminUserId.trim());
      }
    }, [orgAdminUsers, refreshOrgAdminDashboard, refreshOrgAdminUserDetail, refreshOrgAdminUsers, screen, selectedAdminUserId]);
    var initializeApp = (0, _react.useCallback)(/*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
      setIsBootLoading(true);
      setAppError(null);
      try {
        var _configPayload$segmen;
        var _yield$Promise$all3 = yield Promise.all([(0, _srcLibApi.fetchAppConfig)(), (0, _srcLibApi.fetchTimezones)().catch(function () {
            return _voicepracticeShared.COMMON_TIMEZONES;
          }), (0, _srcLibStorage.loadColorScheme)("soft_light"), (0, _srcLibStorage.loadVoiceProfile)("balanced"), (0, _srcLibStorage.loadVoiceGender)("female")]),
          _yield$Promise$all4 = (0, _slicedToArray.default)(_yield$Promise$all3, 5),
          configPayload = _yield$Promise$all4[0],
          timezonePayload = _yield$Promise$all4[1],
          storedScheme = _yield$Promise$all4[2],
          storedVoice = _yield$Promise$all4[3],
          storedVoiceGender = _yield$Promise$all4[4];
        setColorScheme(storedScheme);
        setVoiceProfile(storedVoice);
        setVoiceGender(storedVoiceGender);
        setConfig(configPayload);
        setTimezones(dedupeTimezones(timezonePayload));
        setSelectedDifficulty(configPayload.defaultDifficulty);
        setSelectedPersonaStyle(configPayload.defaultPersonaStyle);
        var preferredSegment = yield (0, _srcLibStorage.loadActiveSegment)(configPayload.activeSegmentId);
        var validSegment = (_configPayload$segmen = configPayload.segments.find(function (segment) {
          return segment.id === preferredSegment && segment.enabled;
        })) != null ? _configPayload$segmen : configPayload.segments.find(function (segment) {
          return segment.enabled;
        });
        if (validSegment) {
          var _firstScenario$id;
          var matchingIndustry = _voicepracticeShared.INDUSTRY_IDS.find(function (industryId) {
            return _voicepracticeShared.INDUSTRY_ROLE_SEGMENT_IDS[industryId].includes(validSegment.id);
          });
          setSelectedIndustryId(matchingIndustry != null ? matchingIndustry : _voicepracticeShared.INDUSTRY_IDS[0]);
          setSelectedRoleId(validSegment.id);
          var firstScenario = validSegment.scenarios.find(function (scenario) {
            return scenario.enabled !== false;
          });
          setSelectedScenarioId((_firstScenario$id = firstScenario == null ? void 0 : firstScenario.id) != null ? _firstScenario$id : "");
        }
        var _yield$Promise$all5 = yield Promise.all([(0, _srcLibStorage.loadUserId)(), (0, _srcLibStorage.loadMobileAuthToken)()]),
          _yield$Promise$all6 = (0, _slicedToArray.default)(_yield$Promise$all5, 2),
          storedUserId = _yield$Promise$all6[0],
          storedMobileToken = _yield$Promise$all6[1];
        if (!storedUserId || !storedMobileToken) {
          setUser(null);
          setEntitlements(null);
          setMobileAuthToken(null);
          setScreen("onboarding");
          return;
        }
        setMobileAuthToken(storedMobileToken);
        var userPayload = yield (0, _srcLibApi.fetchMobileUser)(storedUserId, storedMobileToken);
        var entitlementsPayload = yield (0, _srcLibApi.fetchEntitlements)(storedUserId, storedMobileToken);
        var scopedConfig = yield (0, _srcLibApi.fetchMobileConfig)(storedUserId, storedMobileToken).catch(function () {
          return configPayload;
        });
        setConfig(scopedConfig);
        setUser(userPayload);
        setEntitlements(entitlementsPayload);
        setOnboardingEmail(userPayload.email);
        setOnboardingTimezone(userPayload.timezone);
        setSettingsEmail(userPayload.email);
        setSettingsTimezone(userPayload.timezone);
        setScreen("home");
      } catch (caught) {
        var message = getErrorMessage(caught, "Could not initialize app.");
        var lower = message.toLowerCase();
        if (lower.includes("mobile token") || lower.includes("invalid mobile token")) {
          yield (0, _srcLibStorage.clearUserId)();
          setUser(null);
          setEntitlements(null);
          setMobileAuthToken(null);
          setScreen("onboarding");
        } else {
          setAppError(message);
        }
      } finally {
        setIsBootLoading(false);
      }
    }), []);
    (0, _react.useEffect)(function () {
      void initializeApp();
    }, [initializeApp]);
    (0, _react.useEffect)(function () {
      mobileUpdatesCursorRef.current = 0;
    }, [user == null ? void 0 : user.id]);
    (0, _react.useEffect)(function () {
      if (!user || !mobileAuthToken) {
        return;
      }
      var userId = user.id;
      var cancelled = false;
      var controller = new AbortController();
      var loop = /*#__PURE__*/function () {
        var _ref10 = (0, _asyncToGenerator.default)(function* () {
          while (!cancelled) {
            try {
              var payload = yield (0, _srcLibApi.longPollMobileUpdates)(userId, mobileAuthToken, {
                cursor: mobileUpdatesCursorRef.current,
                timeoutMs: 25000,
                signal: controller.signal
              });
              if (cancelled) {
                return;
              }
              mobileUpdatesCursorRef.current = payload.cursor;
              if (payload.changed) {
                if (payload.user) {
                  setUser(payload.user);
                }
                if (payload.entitlements) {
                  setEntitlements(payload.entitlements);
                }
                if (payload.config) {
                  setConfig(payload.config);
                }
              }
            } catch (caught) {
              if (cancelled) {
                return;
              }
              var message = getErrorMessage(caught, "");
              var lower = message.toLowerCase();
              if (lower.includes("invalid mobile token") || lower.includes("missing mobile token")) {
                yield (0, _srcLibStorage.clearUserId)();
                setUser(null);
                setEntitlements(null);
                setMobileAuthToken(null);
                setScreen("onboarding");
                return;
              }
              if (lower.includes("abort")) {
                return;
              }
              yield new Promise(function (resolve) {
                return setTimeout(resolve, 1500);
              });
            }
          }
        });
        return function loop() {
          return _ref10.apply(this, arguments);
        };
      }();
      void loop();
      return function () {
        cancelled = true;
        controller.abort();
      };
    }, [mobileAuthToken, user == null ? void 0 : user.id]);
    (0, _react.useEffect)(function () {
      if (industryOptions.length === 0) {
        setSelectedIndustryId("");
        return;
      }
      if (!industryOptions.some(function (industry) {
        return industry.id === selectedIndustryId;
      })) {
        setSelectedIndustryId(industryOptions[0].id);
      }
    }, [industryOptions, selectedIndustryId]);
    (0, _react.useEffect)(function () {
      if (!activeIndustry || activeIndustry.roles.length === 0) {
        setSelectedRoleId("");
        return;
      }
      if (!activeIndustry.roles.some(function (role) {
        return role.id === selectedRoleId;
      })) {
        setSelectedRoleId(activeIndustry.roles[0].id);
      }
    }, [activeIndustry, selectedRoleId]);
    (0, _react.useEffect)(function () {
      if (activeScenarios.length === 0) {
        setSelectedScenarioId("");
        return;
      }
      if (!activeScenarios.some(function (scenario) {
        return scenario.id === selectedScenarioId;
      })) {
        setSelectedScenarioId(activeScenarios[0].id);
      }
    }, [activeScenarios, selectedScenarioId]);
    (0, _react.useEffect)(function () {
      if (!selectedRoleId) {
        return;
      }
      void (0, _srcLibStorage.saveActiveSegment)(selectedRoleId);
    }, [selectedRoleId]);
    (0, _react.useEffect)(function () {
      void (0, _srcLibStorage.saveColorScheme)(colorScheme);
    }, [colorScheme]);
    (0, _react.useEffect)(function () {
      void (0, _srcLibStorage.saveVoiceProfile)(voiceProfile);
    }, [voiceProfile]);
    (0, _react.useEffect)(function () {
      void (0, _srcLibStorage.saveVoiceGender)(voiceGender);
    }, [voiceGender]);
    var refreshEntitlements = (0, _react.useCallback)(/*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
      if (!user || !mobileAuthToken) {
        return null;
      }
      var next = yield (0, _srcLibApi.fetchEntitlements)(user.id, mobileAuthToken);
      setEntitlements(next);
      return next;
    }), [mobileAuthToken, user]);
    var runOnboarding = /*#__PURE__*/function () {
      var _ref12 = (0, _asyncToGenerator.default)(function* () {
        setOnboardingError(null);
        var normalizedEmail = onboardingEmail.trim().toLowerCase();
        if (!isEmailLike(normalizedEmail)) {
          setOnboardingError("Please enter a valid email.");
          return;
        }
        if (!onboardingTimezone.trim()) {
          setOnboardingError("Please choose a timezone.");
          return;
        }
        setIsOnboardingSaving(true);
        try {
          var onboarded = yield (0, _srcLibApi.onboardMobileUser)({
            email: normalizedEmail,
            timezone: onboardingTimezone.trim()
          });
          yield Promise.all([(0, _srcLibStorage.saveUserId)(onboarded.user.id), (0, _srcLibStorage.saveMobileAuthToken)(onboarded.authToken)]);
          var nextEntitlements = yield (0, _srcLibApi.fetchEntitlements)(onboarded.user.id, onboarded.authToken);
          var scopedConfig = yield (0, _srcLibApi.fetchMobileConfig)(onboarded.user.id, onboarded.authToken).catch(/*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
            return (0, _srcLibApi.fetchAppConfig)();
          }));
          setConfig(scopedConfig);
          setUser(onboarded.user);
          setMobileAuthToken(onboarded.authToken);
          setEntitlements(nextEntitlements);
          setSettingsEmail(onboarded.user.email);
          setSettingsTimezone(onboarded.user.timezone);
          setScreen("home");
        } catch (caught) {
          setOnboardingError(getErrorMessage(caught, "Could not complete onboarding."));
        } finally {
          setIsOnboardingSaving(false);
        }
      });
      return function runOnboarding() {
        return _ref12.apply(this, arguments);
      };
    }();
    var saveSettings = /*#__PURE__*/function () {
      var _ref14 = (0, _asyncToGenerator.default)(function* () {
        if (!user || !mobileAuthToken) {
          setSettingsError("Session expired. Please sign in again.");
          return;
        }
        setSettingsError(null);
        setSettingsNotice(null);
        var normalizedEmail = settingsEmail.trim().toLowerCase();
        if (!isEmailLike(normalizedEmail)) {
          setSettingsError("Please enter a valid email.");
          return;
        }
        if (!settingsTimezone.trim()) {
          setSettingsError("Please choose a timezone.");
          return;
        }
        setIsSettingsSaving(true);
        try {
          var updated = yield (0, _srcLibApi.updateMobileSettings)(user.id, {
            email: normalizedEmail,
            timezone: settingsTimezone.trim()
          }, mobileAuthToken);
          setUser(updated);
          setSettingsEmail(updated.email);
          setSettingsTimezone(updated.timezone);
          yield refreshEntitlements();
          setSettingsNotice("Settings saved. Timezone changes apply at the next cycle reset.");
        } catch (caught) {
          setSettingsError(getErrorMessage(caught, "Could not save settings."));
        } finally {
          setIsSettingsSaving(false);
        }
      });
      return function saveSettings() {
        return _ref14.apply(this, arguments);
      };
    }();
    var playVoiceSample = /*#__PURE__*/function () {
      var _ref15 = (0, _asyncToGenerator.default)(function* () {
        if (isVoiceSamplePlaying) {
          return;
        }
        setIsVoiceSamplePlaying(true);
        setSettingsNotice(null);
        setSettingsError(null);
        try {
          var _AI_VOICE_GENDER_OPTI, _AI_VOICE_GENDER_OPTI2;
          var sample = (0, _srcDataPreferences.getAiVoiceOption)(voiceProfile);
          var sampleTuning = (0, _srcDataPreferences.getVoiceSpeechTuning)(voiceProfile, voiceGender);
          var availableVoices = yield Speech.getAvailableVoicesAsync().catch(function () {
            return [];
          });
          if (!availableVoices || availableVoices.length === 0) {
            throw new Error("No text-to-speech voices are available on this device/emulator.");
          }
          var selectedVoiceId = (0, _srcDataPreferences.selectSpeechVoiceIdentifier)(availableVoices, voiceGender);
          yield new Promise(function (resolve, reject) {
            Speech.speak("This is a sample of your selected simulator voice.", {
              language: "en-US",
              voice: selectedVoiceId,
              rate: sampleTuning.speechRate,
              pitch: sampleTuning.speechPitch,
              onDone: function onDone() {
                return resolve();
              },
              onStopped: function onStopped() {
                return resolve();
              },
              onError: function onError() {
                return reject(new Error("TTS playback failed."));
              }
            });
          });
          var selectedGenderLabel = (_AI_VOICE_GENDER_OPTI = (_AI_VOICE_GENDER_OPTI2 = _srcDataPreferences.AI_VOICE_GENDER_OPTIONS.find(function (option) {
            return option.id === voiceGender;
          })) == null ? void 0 : _AI_VOICE_GENDER_OPTI2.label) != null ? _AI_VOICE_GENDER_OPTI : "Female";
          setSettingsNotice(`Played sample using ${selectedGenderLabel} ${sample.label} voice style.`);
        } catch (caught) {
          setSettingsError(getErrorMessage(caught, "Could not play voice sample on this device."));
        } finally {
          setIsVoiceSamplePlaying(false);
        }
      });
      return function playVoiceSample() {
        return _ref15.apply(this, arguments);
      };
    }();
    var startSimulation = /*#__PURE__*/function () {
      var _ref16 = (0, _asyncToGenerator.default)(function* () {
        if (!activeSegment || !activeScenario || !user || !mobileAuthToken) {
          setSetupError("Missing setup context. Please refresh and try again.");
          return;
        }
        setSetupError(null);
        try {
          var latestEntitlements = yield refreshEntitlements();
          if (latestEntitlements && !latestEntitlements.canStartSimulation) {
            throw new Error(latestEntitlements.lockReason || "Daily limit reached.");
          }
          var scenario = activeScenario;
          if (!scenario) {
            throw new Error("No scenario available for this segment.");
          }
          setSimulationConfig({
            scenario: scenario,
            difficulty: selectedDifficulty,
            segmentLabel: activeSegment.label,
            personaStyle: selectedPersonaStyle,
            voiceProfile: voiceProfile,
            voiceGender: voiceGender
          });
          setScorecard(null);
          setScorecardError(null);
          setScreen("simulation");
        } catch (caught) {
          setSetupError(getErrorMessage(caught, "Could not start simulation."));
        }
      });
      return function startSimulation() {
        return _ref16.apply(this, arguments);
      };
    }();
    var handleSessionComplete = function handleSessionComplete(history, completedConfig, timing) {
      setSimulationConfig(null);
      setLastCompletedConfig(completedConfig);
      setScorecard(null);
      setScorecardError(null);
      setIsScoring(true);
      setScreen("scorecard");
      if (user && mobileAuthToken) {
        void (0, _asyncToGenerator.default)(function* () {
          try {
            var payload = yield (0, _srcLibApi.recordUsageSession)({
              userId: user.id,
              segmentId: completedConfig.scenario.segmentId,
              scenarioId: completedConfig.scenario.id,
              startedAt: timing.startedAt,
              endedAt: timing.endedAt,
              rawDurationSeconds: timing.rawDurationSeconds
            }, mobileAuthToken);
            setEntitlements(payload.entitlements);
          } catch (caught) {
            setScorecardError(getErrorMessage(caught, "Usage update failed after session."));
          }
        })();
      }
      void (0, _asyncToGenerator.default)(function* () {
        var finalScorecard;
        var scoreError = null;
        try {
          if (!apiConfigured) {
            finalScorecard = fallbackScorecard(history);
            scoreError = "Remote AI is disabled, so fallback scoring was used.";
          } else {
            finalScorecard = yield (0, _srcLibOpenai.evaluateSimulation)({
              scenario: completedConfig.scenario,
              difficulty: completedConfig.difficulty,
              segmentLabel: completedConfig.segmentLabel,
              personaStyle: completedConfig.personaStyle,
              history: history
            });
          }
        } catch (evaluationError) {
          finalScorecard = fallbackScorecard(history);
          scoreError = getErrorMessage(evaluationError, "Score generation failed. Fallback scoring used.");
        } finally {
          setIsScoring(false);
        }
        setScorecard(finalScorecard);
        if (scoreError) {
          setScorecardError(scoreError);
        }
        if (user && mobileAuthToken) {
          try {
            yield (0, _srcLibApi.recordSimulationScore)(user.id, {
              userId: user.id,
              segmentId: completedConfig.scenario.segmentId,
              scenarioId: completedConfig.scenario.id,
              startedAt: timing.startedAt,
              endedAt: timing.endedAt,
              overallScore: finalScorecard.overallScore,
              persuasion: finalScorecard.persuasion,
              clarity: finalScorecard.clarity,
              empathy: finalScorecard.empathy,
              assertiveness: finalScorecard.assertiveness
            }, mobileAuthToken);
          } catch (caught) {
            setScorecardError(function (prev) {
              return prev != null ? prev : getErrorMessage(caught, "Could not sync score history.");
            });
          }
        }
      })();
    };
    var currentTier = (0, _react.useMemo)(function () {
      var _config$tiers$find;
      if (!config || !user) {
        return null;
      }
      return (_config$tiers$find = config.tiers.find(function (tier) {
        return tier.id === user.tier;
      })) != null ? _config$tiers$find : null;
    }, [config, user]);
    var standardTiers = (0, _react.useMemo)(function () {
      var _config$tiers$filter;
      return (_config$tiers$filter = config == null ? void 0 : config.tiers.filter(function (tier) {
        return tier.id === "free" || tier.id === "pro" || tier.id === "pro_plus";
      })) != null ? _config$tiers$filter : [];
    }, [config]);
    var otherPlanTiers = (0, _react.useMemo)(function () {
      var filtered = standardTiers.filter(function (tier) {
        return tier.id !== (user == null ? void 0 : user.tier);
      });
      return filtered.slice(0, 2);
    }, [standardTiers, user == null ? void 0 : user.tier]);
    var hasAdminAccess = Boolean((user == null ? void 0 : user.accountType) === "enterprise" && (user.orgRole === "org_admin" || user.orgRole === "user_admin"));
    var isOrgAdmin = Boolean((user == null ? void 0 : user.accountType) === "enterprise" && user.orgRole === "org_admin");
    var renderHome = function renderHome() {
      var _currentTier$label, _entitlements$usage, _entitlements$usage$d, _entitlements$usage2, _entitlements$usage$b, _entitlements$usage3, _entitlements$usage$n, _entitlements$usage4;
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: styles.fill,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.spacer
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1387,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "Voice Practice"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1388,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.menuButton,
            onPress: function onPress() {
              if (isHomeMenuOpen) {
                closeHomeMenu();
                return;
              }
              openHomeMenu();
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.menuButtonText,
              children: "Menu"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1399,
              columnNumber: 11
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1389,
            columnNumber: 9
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1386,
          columnNumber: 7
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Modal, {
          transparent: true,
          visible: isHomeMenuMounted,
          animationType: "fade",
          onRequestClose: function onRequestClose() {
            return closeHomeMenu();
          },
          children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.menuOverlayRoot,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
              style: styles.menuOverlayBackdrop,
              onPress: function onPress() {
                return closeHomeMenu();
              }
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1409,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Animated.View, {
              style: [styles.menuOverlayCard, {
                transform: [{
                  translateX: homeMenuSlide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [360, 0]
                  })
                }],
                opacity: homeMenuSlide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.45, 1]
                })
              }],
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: styles.menuHeaderRow,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.menuHeading,
                  children: "Profile & Usage"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1430,
                  columnNumber: 15
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: styles.menuCloseButton,
                  onPress: function onPress() {
                    return closeHomeMenu();
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.menuCloseButtonText,
                    children: "X"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1432,
                    columnNumber: 17
                  }, _this4)
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1431,
                  columnNumber: 15
                }, _this4)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1429,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.menuBody,
                children: ["Plan: ", (_currentTier$label = currentTier == null ? void 0 : currentTier.label) != null ? _currentTier$label : "Free"]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1435,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.menuBody,
                children: (entitlements == null || (_entitlements$usage = entitlements.usage) == null ? void 0 : _entitlements$usage.dailySecondsRemaining) === null ? "Daily remaining: unlimited" : `Daily remaining: ${(0, _voicepracticeShared.formatSecondsAsClock)((_entitlements$usage$d = entitlements == null || (_entitlements$usage2 = entitlements.usage) == null ? void 0 : _entitlements$usage2.dailySecondsRemaining) != null ? _entitlements$usage$d : 0)}`
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1436,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.menuBody,
                children: ["Month used: ", (0, _voicepracticeShared.secondsToWholeMinutes)((_entitlements$usage$b = entitlements == null || (_entitlements$usage3 = entitlements.usage) == null ? void 0 : _entitlements$usage3.billedSecondsThisMonth) != null ? _entitlements$usage$b : 0), " min"]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1441,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.menuBody,
                children: ["Reset: ", (_entitlements$usage$n = entitlements == null || (_entitlements$usage4 = entitlements.usage) == null ? void 0 : _entitlements$usage4.nextDailyResetLabel) != null ? _entitlements$usage$n : "Unavailable"]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1444,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: styles.menuSeparator
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1445,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                style: styles.menuItemButton,
                onPress: function onPress() {
                  closeHomeMenu("usage_dashboard");
                },
                children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.menuItemText,
                  children: "Usage Dashboard"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1452,
                  columnNumber: 15
                }, _this4)
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1446,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                style: styles.menuItemButton,
                onPress: function onPress() {
                  closeHomeMenu("settings");
                },
                children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.menuItemText,
                  children: "Settings"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1460,
                  columnNumber: 15
                }, _this4)
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1454,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                style: styles.menuItemButton,
                onPress: function onPress() {
                  closeHomeMenu("profile");
                },
                children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.menuItemText,
                  children: "Profile"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1468,
                  columnNumber: 15
                }, _this4)
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1462,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                style: styles.menuItemButton,
                onPress: function onPress() {
                  closeHomeMenu("subscription");
                },
                children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.menuItemText,
                  children: "Subscription Details"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1476,
                  columnNumber: 15
                }, _this4)
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1470,
                columnNumber: 13
              }, _this4), (user == null ? void 0 : user.accountType) === "enterprise" && (user.orgRole === "org_admin" || user.orgRole === "user_admin") ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: styles.menuSeparator
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1481,
                  columnNumber: 17
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.label,
                  children: "Admin"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1482,
                  columnNumber: 17
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: styles.menuItemButton,
                  onPress: function onPress() {
                    closeHomeMenu("admin_home");
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.menuItemText,
                    children: "Admin"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1489,
                    columnNumber: 19
                  }, _this4)
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1483,
                  columnNumber: 17
                }, _this4)]
              }, void 0, true) : null]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1410,
              columnNumber: 11
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1408,
            columnNumber: 9
          }, _this4)
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1402,
          columnNumber: 7
        }, _this4), function () {
          var heroGradientColors = colorScheme === "soft_light" ? ["rgba(247, 251, 255, 0.99)", "rgba(225, 236, 255, 0.99)", "rgba(206, 222, 252, 0.99)"] : ["rgba(31, 84, 133, 0.98)", "rgba(14, 45, 77, 0.98)", "rgba(9, 30, 52, 0.98)"];
          return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoLinearGradient.LinearGradient, {
            colors: heroGradientColors,
            start: {
              x: 0,
              y: 0
            },
            end: {
              x: 1,
              y: 1
            },
            style: styles.heroCard,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.heroGlowOne
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1505,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.heroGlowTwo
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1506,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.heroTitle,
              children: "CounterMatch"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1507,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.heroSubtitle,
              children: "Build Confidence Under Pressure"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1508,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.heroRule
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1509,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.heroBody,
              children: "Practice high-stakes professional conversations by voice with dynamic AI role-play."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1510,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.heroChipRow,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: styles.heroChip,
                children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.heroChipText,
                  children: "Live Voice"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1515,
                  columnNumber: 17
                }, _this4)
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1514,
                columnNumber: 15
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: styles.heroChip,
                children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.heroChipText,
                  children: "Scenario Drills"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1518,
                  columnNumber: 17
                }, _this4)
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1517,
                columnNumber: 15
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1513,
              columnNumber: 13
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1504,
            columnNumber: 11
          }, _this4);
        }(), activeSegment ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: [styles.card, styles.segmentCard],
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.segmentLabel,
            children: "Active Role"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1527,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.segmentTitle,
            children: activeSegment.label
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1528,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.body,
            children: activeSegment.summary
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1529,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1526,
          columnNumber: 9
        }, _this4) : null, !apiConfigured ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.warningCard,
          children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.warningText,
            children: "Remote AI is intentionally disabled in this build. Simulation and scoring run in local mode only."
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1535,
            columnNumber: 11
          }, _this4)
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1534,
          columnNumber: 9
        }, _this4) : null, entitlements != null && entitlements.lockReason ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.errorCard,
          children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.errorText,
            children: entitlements.lockReason
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1543,
            columnNumber: 11
          }, _this4)
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1542,
          columnNumber: 9
        }, _this4) : null, /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
          style: styles.primaryButton,
          onPress: function onPress() {
            return setScreen("setup");
          },
          children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.primaryButtonText,
            children: "Let's get started"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1548,
            columnNumber: 9
          }, _this4)
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1547,
          columnNumber: 7
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 1385,
        columnNumber: 5
      }, _this4);
    };
    var renderOnboarding = function renderOnboarding() {
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.KeyboardAvoidingView, {
        style: styles.fill,
        behavior: _reactNative.Platform.OS === "ios" ? "padding" : undefined,
        keyboardVerticalOffset: 20,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.spacer
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1560,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "First-Time Setup"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1561,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.spacer
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1562,
            columnNumber: 9
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1559,
          columnNumber: 7
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: styles.scroll,
          contentContainerStyle: styles.scrollContent,
          children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Create Your Local Profile"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1566,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["This stores your email and timezone for daily reset and monthly renewal timing.", "\n", "Autodetected timezone: ", detectedTimezone, "\n", "You can change timezone now, but future timezone changes apply on the next cycle reset."]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1567,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TextInput, {
              value: onboardingEmail,
              onChangeText: setOnboardingEmail,
              placeholder: "Email address",
              placeholderTextColor: theme.hint,
              keyboardType: "email-address",
              autoCapitalize: "none",
              style: styles.input
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1574,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.hintText,
              children: "Timezone"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1583,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(TimezoneDropdown, {
              value: onboardingTimezone,
              options: mergedTimezones,
              onChange: setOnboardingTimezone,
              placeholder: "Select timezone",
              styles: styles
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1584,
              columnNumber: 11
            }, _this4), onboardingTimezone !== detectedTimezone ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
              style: styles.inlineActionButton,
              onPress: function onPress() {
                return setOnboardingTimezone(detectedTimezone);
              },
              children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.inlineActionButtonText,
                children: ["Use detected timezone: ", detectedTimezone]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1593,
                columnNumber: 15
              }, _this4)
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1592,
              columnNumber: 13
            }, _this4) : null, onboardingError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.errorText,
              children: onboardingError
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1596,
              columnNumber: 30
            }, _this4) : null]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1565,
            columnNumber: 9
          }, _this4)
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1564,
          columnNumber: 7
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
          style: [styles.primaryButton, isOnboardingSaving ? styles.disabled : null],
          disabled: isOnboardingSaving,
          onPress: function onPress() {
            void runOnboarding();
          },
          children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.primaryButtonText,
            children: isOnboardingSaving ? "Saving..." : "Continue"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1606,
            columnNumber: 9
          }, _this4)
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1599,
          columnNumber: 7
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 1554,
        columnNumber: 5
      }, _this4);
    };
    var renderSetup = function renderSetup() {
      var _entitlements$usage$n2, _entitlements$usage5, _entitlements$usage6, _entitlements$usage$d2, _entitlements$usage7;
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: styles.fill,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.ghostButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1615,
              columnNumber: 11
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1614,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "Setup"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1617,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.spacer
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1618,
            columnNumber: 9
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1613,
          columnNumber: 7
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: styles.scroll,
          contentContainerStyle: styles.scrollContent,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.sectionTitle,
              children: "Session Selection"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1623,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.hintText,
              children: "Industry"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1625,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(SelectionDropdown, {
              title: "Industry",
              value: selectedIndustryId,
              options: industrySelectOptions,
              onChange: function onChange(value) {
                return setSelectedIndustryId(value);
              },
              placeholder: "Select industry",
              styles: styles
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1626,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.hintText,
              children: "Role"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1635,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(SelectionDropdown, {
              title: "Role",
              value: selectedRoleId,
              options: roleSelectOptions,
              onChange: setSelectedRoleId,
              placeholder: "Select role",
              styles: styles
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1636,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.hintText,
              children: "Scenario"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1645,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(SelectionDropdown, {
              title: "Scenario",
              value: selectedScenarioId,
              options: scenarioSelectOptions,
              onChange: setSelectedScenarioId,
              placeholder: "Select scenario",
              styles: styles
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1646,
              columnNumber: 11
            }, _this4), activeSegment ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: activeSegment.summary
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1655,
              columnNumber: 28
            }, _this4) : null, activeScenario ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: activeScenario.description
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1656,
              columnNumber: 29
            }, _this4) : null]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1622,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.sectionTitle,
            children: "Difficulty"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1659,
            columnNumber: 9
          }, _this4), Object.keys(_srcDataPrompts.DIFFICULTY_LABELS).map(function (difficulty) {
            return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
              style: [styles.optionCard, selectedDifficulty === difficulty ? styles.selectedCard : null],
              onPress: function onPress() {
                return setSelectedDifficulty(difficulty);
              },
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.optionTitle,
                children: _srcDataPrompts.DIFFICULTY_LABELS[difficulty]
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1666,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: _srcDataPrompts.DIFFICULTY_HINTS[difficulty]
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1667,
                columnNumber: 13
              }, _this4)]
            }, difficulty, true, {
              fileName: _jsxFileName,
              lineNumber: 1661,
              columnNumber: 11
            }, _this4);
          }), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.sectionTitle,
            children: "Opponent Persona Style"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1671,
            columnNumber: 9
          }, _this4), Object.keys(_srcDataPrompts.PERSONA_LABELS).map(function (personaStyle) {
            return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
              style: [styles.optionCard, selectedPersonaStyle === personaStyle ? styles.selectedCard : null],
              onPress: function onPress() {
                return setSelectedPersonaStyle(personaStyle);
              },
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.optionTitle,
                children: _srcDataPrompts.PERSONA_LABELS[personaStyle]
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1678,
                columnNumber: 13
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: _srcDataPrompts.PERSONA_HINTS[personaStyle]
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1679,
                columnNumber: 13
              }, _this4)]
            }, personaStyle, true, {
              fileName: _jsxFileName,
              lineNumber: 1673,
              columnNumber: 11
            }, _this4);
          }), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.label,
              children: "Usage Check"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1684,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: (_entitlements$usage$n2 = entitlements == null || (_entitlements$usage5 = entitlements.usage) == null ? void 0 : _entitlements$usage5.nextDailyResetLabel) != null ? _entitlements$usage$n2 : "Daily reset unavailable."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1685,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: (entitlements == null || (_entitlements$usage6 = entitlements.usage) == null ? void 0 : _entitlements$usage6.dailySecondsRemaining) === null ? "Daily remaining: unlimited" : `Daily remaining: ${(0, _voicepracticeShared.formatSecondsAsClock)((_entitlements$usage$d2 = entitlements == null || (_entitlements$usage7 = entitlements.usage) == null ? void 0 : _entitlements$usage7.dailySecondsRemaining) != null ? _entitlements$usage$d2 : 0)}`
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1686,
              columnNumber: 11
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1683,
            columnNumber: 9
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1621,
          columnNumber: 7
        }, _this4), setupError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: styles.errorText,
          children: setupError
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1694,
          columnNumber: 21
        }, _this4) : null, /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
          style: styles.primaryButton,
          onPress: function onPress() {
            return void startSimulation();
          },
          children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.primaryButtonText,
            children: "Start Simulation"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1697,
            columnNumber: 9
          }, _this4)
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1696,
          columnNumber: 7
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 1612,
        columnNumber: 5
      }, _this4);
    };
    var renderProfile = function renderProfile() {
      var _user$timezone, _user$pendingTimezone, _user$pendingTimezone2, _entitlements$usage$n3, _entitlements$usage8;
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.KeyboardAvoidingView, {
        style: styles.fill,
        behavior: _reactNative.Platform.OS === "ios" ? "padding" : undefined,
        keyboardVerticalOffset: 20,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.ghostButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1710,
              columnNumber: 11
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1709,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "Profile"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1712,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.spacer
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1713,
            columnNumber: 9
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1708,
          columnNumber: 7
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: styles.scroll,
          contentContainerStyle: styles.scrollContent,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Account"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1717,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Autodetected timezone: ", detectedTimezone, "\n", "You can change timezone, but updates apply on your next cycle reset."]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1718,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TextInput, {
              value: settingsEmail,
              onChangeText: setSettingsEmail,
              placeholder: "Email address",
              placeholderTextColor: theme.hint,
              keyboardType: "email-address",
              autoCapitalize: "none",
              style: styles.input
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1723,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.hintText,
              children: "Timezone"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1732,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(TimezoneDropdown, {
              value: settingsTimezone,
              options: mergedTimezones,
              onChange: setSettingsTimezone,
              placeholder: "Select timezone",
              styles: styles
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1733,
              columnNumber: 11
            }, _this4), settingsTimezone !== detectedTimezone ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
              style: styles.inlineActionButton,
              onPress: function onPress() {
                return setSettingsTimezone(detectedTimezone);
              },
              children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.inlineActionButtonText,
                children: ["Use detected timezone: ", detectedTimezone]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1742,
                columnNumber: 15
              }, _this4)
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1741,
              columnNumber: 13
            }, _this4) : null, /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Current timezone: ", (_user$timezone = user == null ? void 0 : user.timezone) != null ? _user$timezone : "N/A", "\n", "Pending timezone: ", (_user$pendingTimezone = user == null ? void 0 : user.pendingTimezone) != null ? _user$pendingTimezone : "None", "\n", "Pending applies at: ", formatDateLabel((_user$pendingTimezone2 = user == null ? void 0 : user.pendingTimezoneEffectiveAt) != null ? _user$pendingTimezone2 : null)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1745,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Next monthly renewal: ", formatDateLabel((_entitlements$usage$n3 = entitlements == null || (_entitlements$usage8 = entitlements.usage) == null ? void 0 : _entitlements$usage8.nextRenewalAt) != null ? _entitlements$usage$n3 : null)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1750,
              columnNumber: 11
            }, _this4), settingsNotice ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.successText,
              children: settingsNotice
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1753,
              columnNumber: 29
            }, _this4) : null, settingsError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.errorText,
              children: settingsError
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1754,
              columnNumber: 28
            }, _this4) : null, /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
              style: [styles.primaryButton, isSettingsSaving ? styles.disabled : null],
              disabled: isSettingsSaving,
              onPress: function onPress() {
                void saveSettings();
              },
              children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.primaryButtonText,
                children: isSettingsSaving ? "Saving..." : "Save Profile"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1762,
                columnNumber: 13
              }, _this4)
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1755,
              columnNumber: 11
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1716,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: [styles.ghostButton, styles.signOutButton],
            onPress: function onPress() {
              void (0, _asyncToGenerator.default)(function* () {
                yield (0, _srcLibStorage.clearUserId)();
                setUser(null);
                setMobileAuthToken(null);
                setEntitlements(null);
                setOnboardingEmail("");
                setOnboardingTimezone(detectedTimezone);
                setSettingsEmail("");
                setSettingsTimezone(detectedTimezone);
                setScreen("onboarding");
              })();
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: "Reset Local User"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1782,
              columnNumber: 11
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1766,
            columnNumber: 9
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1715,
          columnNumber: 7
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 1703,
        columnNumber: 5
      }, _this4);
    };
    var renderSettings = function renderSettings() {
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: styles.fill,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.ghostButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1792,
              columnNumber: 11
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1791,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "Settings"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1794,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.spacer
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1795,
            columnNumber: 9
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1790,
          columnNumber: 7
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: styles.scroll,
          contentContainerStyle: styles.scrollContent,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Appearance"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1800,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Choose your app color scheme."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1801,
              columnNumber: 11
            }, _this4), _srcDataPreferences.COLOR_SCHEME_OPTIONS.map(function (option) {
              return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                style: [styles.optionCard, colorScheme === option.id ? styles.selectedCard : null],
                onPress: function onPress() {
                  return setColorScheme(option.id);
                },
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.optionTitle,
                  children: option.label
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1808,
                  columnNumber: 15
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.body,
                  children: option.description
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1809,
                  columnNumber: 15
                }, _this4)]
              }, option.id, true, {
                fileName: _jsxFileName,
                lineNumber: 1803,
                columnNumber: 13
              }, _this4);
            })]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1799,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "AI Voice"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1815,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Choose the simulator voice style here. This is designed to be set outside an active session."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1816,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.voiceToggleRow,
              children: _srcDataPreferences.AI_VOICE_GENDER_OPTIONS.map(function (option) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: [styles.voiceToggleButton, voiceGender === option.id ? styles.selectedCard : null],
                  onPress: function onPress() {
                    return setVoiceGender(option.id);
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.voiceToggleText,
                    children: option.label
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1829,
                    columnNumber: 17
                  }, _this4)
                }, option.id, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1821,
                  columnNumber: 15
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1819,
              columnNumber: 11
            }, _this4), _srcDataPreferences.AI_VOICE_OPTIONS.map(function (option) {
              return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                style: [styles.optionCard, voiceProfile === option.id ? styles.selectedCard : null],
                onPress: function onPress() {
                  return setVoiceProfile(option.id);
                },
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.optionTitle,
                  children: option.label
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1839,
                  columnNumber: 15
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.body,
                  children: option.description
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1840,
                  columnNumber: 15
                }, _this4)]
              }, option.id, true, {
                fileName: _jsxFileName,
                lineNumber: 1834,
                columnNumber: 13
              }, _this4);
            }), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
              style: [styles.linkButton, isVoiceSamplePlaying ? styles.disabled : null],
              disabled: isVoiceSamplePlaying,
              onPress: function onPress() {
                void playVoiceSample();
              },
              children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.linkButtonText,
                children: isVoiceSamplePlaying ? "Playing sample..." : "Play Voice Sample"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1850,
                columnNumber: 13
              }, _this4)
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1843,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Current voice: ", voiceGender === "male" ? "Male" : "Female", " ", selectedVoiceOption.label]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1854,
              columnNumber: 11
            }, _this4), settingsNotice ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.successText,
              children: settingsNotice
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1857,
              columnNumber: 29
            }, _this4) : null, settingsError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.errorText,
              children: settingsError
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1858,
              columnNumber: 28
            }, _this4) : null]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1814,
            columnNumber: 9
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1798,
          columnNumber: 7
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 1789,
        columnNumber: 5
      }, _this4);
    };
    var renderSubscription = function renderSubscription() {
      var _currentTier$label2, _currentTier$descript, _currentTier$priceUsd, _currentTier$dailySec, _entitlements$usage$b2, _entitlements$usage9, _entitlements$usage0, _entitlements$usage$d3, _entitlements$usage1;
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: styles.fill,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.ghostButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1868,
              columnNumber: 11
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1867,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "Subscription Details"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1870,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.spacer
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1871,
            columnNumber: 9
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1866,
          columnNumber: 7
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: styles.scroll,
          contentContainerStyle: styles.scrollContent,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.label,
              children: "Your Plan"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1875,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: (_currentTier$label2 = currentTier == null ? void 0 : currentTier.label) != null ? _currentTier$label2 : "Free"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1876,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: (_currentTier$descript = currentTier == null ? void 0 : currentTier.description) != null ? _currentTier$descript : "Basic training access."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1877,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Price: $", ((_currentTier$priceUsd = currentTier == null ? void 0 : currentTier.priceUsdMonthly) != null ? _currentTier$priceUsd : 0).toFixed(2), "/month"]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1878,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Daily simulation: ", (currentTier == null ? void 0 : currentTier.dailySecondsLimit) === null ? "Custom" : `${(0, _voicepracticeShared.secondsToWholeMinutes)((_currentTier$dailySec = currentTier == null ? void 0 : currentTier.dailySecondsLimit) != null ? _currentTier$dailySec : 0)} minutes`]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1879,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Support included: ", currentTier != null && currentTier.supportIncluded ? "Yes" : "No"]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1884,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Used this month: ", (0, _voicepracticeShared.secondsToWholeMinutes)((_entitlements$usage$b2 = entitlements == null || (_entitlements$usage9 = entitlements.usage) == null ? void 0 : _entitlements$usage9.billedSecondsThisMonth) != null ? _entitlements$usage$b2 : 0), " min billed"]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1885,
              columnNumber: 11
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Daily remaining: ", (entitlements == null || (_entitlements$usage0 = entitlements.usage) == null ? void 0 : _entitlements$usage0.dailySecondsRemaining) === null ? "unlimited" : (0, _voicepracticeShared.formatSecondsAsClock)((_entitlements$usage$d3 = entitlements == null || (_entitlements$usage1 = entitlements.usage) == null ? void 0 : _entitlements$usage1.dailySecondsRemaining) != null ? _entitlements$usage$d3 : 0)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1888,
              columnNumber: 11
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1874,
            columnNumber: 9
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.label,
              children: "Other Plans"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1896,
              columnNumber: 11
            }, _this4), otherPlanTiers.map(function (tier) {
              return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: styles.optionCard,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.optionTitle,
                  children: [tier.label, " - $", tier.priceUsdMonthly.toFixed(2), "/month"]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1899,
                  columnNumber: 15
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.body,
                  children: tier.description
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1900,
                  columnNumber: 15
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.body,
                  children: ["Daily simulation: ", tier.dailySecondsLimit === null ? "Custom" : `${(0, _voicepracticeShared.secondsToWholeMinutes)(tier.dailySecondsLimit)} minutes`]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1901,
                  columnNumber: 15
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.body,
                  children: ["Support included: ", tier.supportIncluded ? "Yes" : "No"]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1906,
                  columnNumber: 15
                }, _this4)]
              }, tier.id, true, {
                fileName: _jsxFileName,
                lineNumber: 1898,
                columnNumber: 13
              }, _this4);
            }), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Enterprise option is also available for org-level controls, custom quotas, and team rollouts."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1909,
              columnNumber: 11
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1895,
            columnNumber: 9
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1873,
          columnNumber: 7
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 1865,
        columnNumber: 5
      }, _this4);
    };
    var renderUsageDashboard = function renderUsageDashboard() {
      var _scoreSummary$totals$, _scoreSummary$totals, _scoreSummary$totals$2, _scoreSummary$totals2;
      var showSegmentFilter = dashboardSegmentSelectOptions.length > 1;
      var segmentFilterOptions = showSegmentFilter ? [{
        value: "",
        label: "All segments"
      }].concat((0, _toConsumableArray.default)(dashboardSegmentSelectOptions)) : dashboardSegmentSelectOptions;
      var avgScore = (_scoreSummary$totals$ = scoreSummary == null || (_scoreSummary$totals = scoreSummary.totals) == null ? void 0 : _scoreSummary$totals.avgOverallScore) != null ? _scoreSummary$totals$ : null;
      var sessionCount = (_scoreSummary$totals$2 = scoreSummary == null || (_scoreSummary$totals2 = scoreSummary.totals) == null ? void 0 : _scoreSummary$totals2.sessions) != null ? _scoreSummary$totals$2 : 0;
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: styles.fill,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.ghostButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1930,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1929,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "Usage Dashboard"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1932,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: [styles.ghostButton, dashboardLoading ? styles.disabled : null],
            disabled: dashboardLoading,
            onPress: function onPress() {
              void refreshScoreDashboard();
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: dashboardLoading ? "Loading..." : "Refresh"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1940,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1933,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1928,
          columnNumber: 9
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: styles.scroll,
          contentContainerStyle: styles.scrollContent,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Average Score"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1946,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "See how you're trending over time. Scores are averaged across completed sessions."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1947,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.hintText,
              children: "Date Range"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1951,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
              horizontal: true,
              showsHorizontalScrollIndicator: false,
              contentContainerStyle: styles.chipRow,
              children: [7, 30, 90].map(function (days) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: [styles.timezoneChip, dashboardDays === days ? styles.selectedChip : null],
                  onPress: function onPress() {
                    return setDashboardDays(days);
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.chipText,
                    children: [days, "d"]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 1962,
                    columnNumber: 19
                  }, _this4)
                }, days, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1954,
                  columnNumber: 17
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1952,
              columnNumber: 13
            }, _this4), showSegmentFilter ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.hintText,
                children: "Segment"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1969,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(SelectionDropdown, {
                value: dashboardSegmentId,
                options: segmentFilterOptions,
                onChange: setDashboardSegmentId,
                placeholder: "All segments",
                title: "Segment",
                styles: styles
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1970,
                columnNumber: 17
              }, _this4)]
            }, void 0, true) : null, /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                flexDirection: "row",
                gap: 12,
                marginTop: 6,
                flexWrap: "wrap"
              },
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: [styles.optionCard, {
                  flex: 1,
                  minWidth: 160
                }],
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.label,
                  children: "Avg Score"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1983,
                  columnNumber: 17
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.title,
                  children: avgScore === null ? "-" : avgScore.toFixed(1)
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1984,
                  columnNumber: 17
                }, _this4)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1982,
                columnNumber: 15
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: [styles.optionCard, {
                  flex: 1,
                  minWidth: 160
                }],
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.label,
                  children: "Sessions"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1987,
                  columnNumber: 17
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.title,
                  children: sessionCount
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1988,
                  columnNumber: 17
                }, _this4)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1986,
                columnNumber: 15
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1981,
              columnNumber: 13
            }, _this4), scoreSummary != null && scoreSummary.generatedAt ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Updated: ", formatDateLabel(scoreSummary.generatedAt)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1993,
              columnNumber: 15
            }, _this4) : null]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 1945,
            columnNumber: 11
          }, _this4), dashboardError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.errorCard,
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.errorText,
              children: dashboardError
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 1999,
              columnNumber: 15
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1998,
            columnNumber: 13
          }, _this4) : null, /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Score Trend"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2004,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Daily average score for the selected range."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2005,
              columnNumber: 13
            }, _this4), dashboardLoading ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.centered,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ActivityIndicator, {
                size: "small",
                color: theme.accent
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2009,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "Loading trend..."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2010,
                columnNumber: 17
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2008,
              columnNumber: 15
            }, _this4) : scoreSummary && scoreSummary.byDay.length > 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                gap: 10,
                marginTop: 4
              },
              children: scoreSummary.byDay.map(function (row) {
                var _row$avgOverallScore;
                var pct = Math.max(0, Math.min(1, ((_row$avgOverallScore = row.avgOverallScore) != null ? _row$avgOverallScore : 0) / 100));
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    gap: 6
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: {
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 10
                    },
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: styles.body,
                      children: row.dayKey
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 2019,
                      columnNumber: 25
                    }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: styles.body,
                      children: [row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1), " (", row.sessions, ")"]
                    }, void 0, true, {
                      fileName: _jsxFileName,
                      lineNumber: 2020,
                      columnNumber: 25
                    }, _this4)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2018,
                    columnNumber: 23
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: {
                      height: 10,
                      borderRadius: 999,
                      backgroundColor: theme.border,
                      overflow: "hidden"
                    },
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                      style: {
                        width: `${Math.round(pct * 100)}%`,
                        height: "100%",
                        backgroundColor: theme.accent
                      }
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 2032,
                      columnNumber: 25
                    }, _this4)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2024,
                    columnNumber: 23
                  }, _this4)]
                }, row.dayKey, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2017,
                  columnNumber: 21
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2013,
              columnNumber: 15
            }, _this4) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "(No scored sessions in this period yet.)"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2045,
              columnNumber: 15
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2003,
            columnNumber: 11
          }, _this4), scoreSummary && !dashboardSegmentId.trim() ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "By Segment"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2051,
              columnNumber: 15
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Average score and session count for each segment."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2052,
              columnNumber: 15
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                gap: 10,
                marginTop: 6
              },
              children: scoreSummary.bySegment.length === 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "(No segment data yet.)"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2055,
                columnNumber: 19
              }, _this4) : scoreSummary.bySegment.map(function (row) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: styles.optionCard,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.optionTitle,
                    children: row.segmentLabel
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2059,
                    columnNumber: 23
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.body,
                    children: ["Avg score: ", row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1), "\n", "Sessions: ", row.sessions]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2060,
                    columnNumber: 23
                  }, _this4)]
                }, row.segmentId, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2058,
                  columnNumber: 21
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2053,
              columnNumber: 15
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2050,
            columnNumber: 13
          }, _this4) : null, scoreSummary ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Recent Scores"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2073,
              columnNumber: 15
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Latest scored sessions in this range."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2074,
              columnNumber: 15
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                gap: 10,
                marginTop: 6
              },
              children: scoreSummary.recent.length === 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "(No recent scores.)"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2077,
                columnNumber: 19
              }, _this4) : scoreSummary.recent.map(function (row) {
                var _segmentLabelById$get, _scenarioTitleById$ge;
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: styles.optionCard,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.optionTitle,
                    children: ["Score: ", row.overallScore]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2081,
                    columnNumber: 23
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.body,
                    children: [formatDateLabel(row.endedAt), "\n", "Segment: ", (_segmentLabelById$get = segmentLabelById.get(row.segmentId)) != null ? _segmentLabelById$get : row.segmentId, "\n", "Scenario: ", (_scenarioTitleById$ge = scenarioTitleById.get(row.scenarioId)) != null ? _scenarioTitleById$ge : row.scenarioId]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2082,
                    columnNumber: 23
                  }, _this4)]
                }, row.id, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2080,
                  columnNumber: 21
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2075,
              columnNumber: 15
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2072,
            columnNumber: 13
          }, _this4) : null]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1944,
          columnNumber: 9
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 1927,
        columnNumber: 7
      }, _this4);
    };
    var renderAdminHome = function renderAdminHome() {
      var _ref20, _ref21, _orgAdminUsers$org$na, _orgAdminUsers$org, _orgAdminDashboard$or, _orgAdminUserDetail$o, _ref22, _user$orgRole;
      if (!user) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.centered,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.errorText,
            children: "Missing user profile."
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2102,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.primaryButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.primaryButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2104,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2103,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2101,
          columnNumber: 9
        }, _this4);
      }
      if (!hasAdminAccess) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.centered,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.errorText,
            children: "Admin access required."
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2113,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.primaryButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.primaryButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2115,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2114,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2112,
          columnNumber: 9
        }, _this4);
      }
      var orgName = (_ref20 = (_ref21 = (_orgAdminUsers$org$na = orgAdminUsers == null || (_orgAdminUsers$org = orgAdminUsers.org) == null ? void 0 : _orgAdminUsers$org.name) != null ? _orgAdminUsers$org$na : orgAdminDashboard == null || (_orgAdminDashboard$or = orgAdminDashboard.org) == null ? void 0 : _orgAdminDashboard$or.name) != null ? _ref21 : orgAdminUserDetail == null || (_orgAdminUserDetail$o = orgAdminUserDetail.org) == null ? void 0 : _orgAdminUserDetail$o.name) != null ? _ref20 : "Your organization";
      var roleLabel = (_ref22 = (_user$orgRole = _voicepracticeShared.ORG_USER_ROLE_LABELS[user.orgRole]) != null ? _user$orgRole : user.orgRole) != null ? _ref22 : "user";
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: styles.fill,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.ghostButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2130,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2129,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "Admin"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2132,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: [styles.ghostButton, adminLoading ? styles.disabled : null],
            disabled: adminLoading,
            onPress: function onPress() {
              if (isOrgAdmin) {
                void refreshOrgAdminDashboard();
              } else {
                void refreshOrgAdminUsers();
              }
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: adminLoading ? "Loading..." : "Refresh"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2144,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2133,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2128,
          columnNumber: 9
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: styles.scroll,
          contentContainerStyle: styles.scrollContent,
          children: [adminError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.errorCard,
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.errorText,
              children: adminError
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2151,
              columnNumber: 15
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2150,
            columnNumber: 13
          }, _this4) : null, /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.label,
              children: "Organization"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2156,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: orgName
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2157,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Role: ", roleLabel]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2158,
              columnNumber: 13
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2155,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Tools"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2162,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Review account performance and manage who can access the app."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2163,
              columnNumber: 13
            }, _this4), isOrgAdmin ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
              style: styles.menuItemButton,
              onPress: function onPress() {
                setAdminError(null);
                setScreen("admin_org_dashboard");
              },
              children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.menuItemText,
                children: "Org Dashboard"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2174,
                columnNumber: 17
              }, _this4)
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2167,
              columnNumber: 15
            }, _this4) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.optionCard,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.optionTitle,
                children: "Limited Scope"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2178,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "User Admins can lock/unlock users and review user-level activity. Contract and org-wide analytics are restricted to Org Admins."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2179,
                columnNumber: 17
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2177,
              columnNumber: 15
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
              style: styles.menuItemButton,
              onPress: function onPress() {
                setAdminError(null);
                setScreen("admin_user_list");
              },
              children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.menuItemText,
                children: "Manage Users"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2193,
                columnNumber: 15
              }, _this4)
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2186,
              columnNumber: 13
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2161,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2148,
          columnNumber: 9
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 2127,
        columnNumber: 7
      }, _this4);
    };
    var renderAdminOrgDashboard = function renderAdminOrgDashboard() {
      var _orgAdminDashboard$or2, _orgAdminDashboard$bi, _orgAdminDashboard$us, _usage$annualizedAllo, _usage$billedSecondsT, _orgAdminAnalytics$by, _org$name, _usage$dailyQuotaSeco, _usage$perUserDailyCa, _org$manualBonusSecon, _orgAdminAnalytics$to, _orgAdminAnalytics$to2, _orgAdminAnalytics$by2, _orgAdminAnalytics$by3;
      if (!hasAdminAccess || !user) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.centered,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.errorText,
            children: "Admin access required."
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2205,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.primaryButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.primaryButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2207,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2206,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2204,
          columnNumber: 9
        }, _this4);
      }
      if (!isOrgAdmin) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.centered,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.errorText,
            children: "Org admin access required."
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2216,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.primaryButton,
            onPress: function onPress() {
              return setScreen("admin_home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.primaryButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2218,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2217,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2215,
          columnNumber: 9
        }, _this4);
      }
      var org = (_orgAdminDashboard$or2 = orgAdminDashboard == null ? void 0 : orgAdminDashboard.org) != null ? _orgAdminDashboard$or2 : null;
      var billing = (_orgAdminDashboard$bi = orgAdminDashboard == null ? void 0 : orgAdminDashboard.billingPeriod) != null ? _orgAdminDashboard$bi : null;
      var usage = (_orgAdminDashboard$us = orgAdminDashboard == null ? void 0 : orgAdminDashboard.usage) != null ? _orgAdminDashboard$us : null;
      var industriesLabel = Array.isArray(org == null ? void 0 : org.activeIndustries) && (org == null ? void 0 : org.activeIndustries.length) > 0 ? org.activeIndustries.map(function (industryId) {
        var _INDUSTRY_LABELS;
        return (_INDUSTRY_LABELS = _voicepracticeShared.INDUSTRY_LABELS[industryId]) != null ? _INDUSTRY_LABELS : String(industryId);
      }).join(", ") : "-";
      var allotmentSeconds = (_usage$annualizedAllo = usage == null ? void 0 : usage.annualizedAllotmentSeconds) != null ? _usage$annualizedAllo : 0;
      var usedSeconds = (_usage$billedSecondsT = usage == null ? void 0 : usage.billedSecondsThisPeriod) != null ? _usage$billedSecondsT : 0;
      var usagePct = allotmentSeconds > 0 ? Math.min(1, usedSeconds / allotmentSeconds) : 0;
      var analyticsSessions = (_orgAdminAnalytics$by = orgAdminAnalytics == null ? void 0 : orgAdminAnalytics.bySegment.reduce(function (total, row) {
        var _row$sessions;
        return total + ((_row$sessions = row.sessions) != null ? _row$sessions : 0);
      }, 0)) != null ? _orgAdminAnalytics$by : 0;
      var byIndustry = function () {
        if (!orgAdminAnalytics) {
          return [];
        }
        var grouped = new Map();
        for (var row of orgAdminAnalytics.bySegment) {
          var _grouped$get, _row$sessions2, _row$avgOverallScore2;
          var industryId = industryIdByRoleSegmentId.get(row.segmentId);
          if (!industryId) {
            continue;
          }
          var current = (_grouped$get = grouped.get(industryId)) != null ? _grouped$get : {
            sessions: 0,
            totalScore: 0
          };
          var sessions = (_row$sessions2 = row.sessions) != null ? _row$sessions2 : 0;
          var avg = (_row$avgOverallScore2 = row.avgOverallScore) != null ? _row$avgOverallScore2 : 0;
          grouped.set(industryId, {
            sessions: current.sessions + sessions,
            totalScore: current.totalScore + avg * sessions
          });
        }
        return Array.from(grouped.entries()).map(function (_ref23) {
          var _INDUSTRY_LABELS2;
          var _ref24 = (0, _slicedToArray.default)(_ref23, 2),
            industryId = _ref24[0],
            row = _ref24[1];
          return {
            industryId: industryId,
            industryLabel: (_INDUSTRY_LABELS2 = _voicepracticeShared.INDUSTRY_LABELS[industryId]) != null ? _INDUSTRY_LABELS2 : industryId,
            sessions: row.sessions,
            avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
          };
        }).sort(function (a, b) {
          return b.sessions - a.sessions;
        });
      }();
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: styles.fill,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.ghostButton,
            onPress: function onPress() {
              return setScreen("admin_home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2273,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2272,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "Org Dashboard"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2275,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: [styles.ghostButton, adminLoading ? styles.disabled : null],
            disabled: adminLoading,
            onPress: function onPress() {
              return void refreshOrgAdminDashboard();
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: adminLoading ? "Loading..." : "Refresh"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2281,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2276,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2271,
          columnNumber: 9
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: styles.scroll,
          contentContainerStyle: styles.scrollContent,
          children: [adminError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.errorCard,
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.errorText,
              children: adminError
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2288,
              columnNumber: 15
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2287,
            columnNumber: 13
          }, _this4) : null, /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.label,
              children: "Contract & Usage"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2293,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: (_org$name = org == null ? void 0 : org.name) != null ? _org$name : "Organization"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2294,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Industries: ", industriesLabel, "\n", "Period: ", billing ? `${formatDateLabel(billing.periodStartAt)} to ${formatDateLabel(billing.periodEndAt)}` : "-", "\n", "Next renewal: ", billing ? formatDateLabel(billing.nextRenewalAt) : "-"]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2295,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                gap: 10,
                marginTop: 6
              },
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: styles.optionCard,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.optionTitle,
                  children: "Annual Allotment"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2303,
                  columnNumber: 17
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.body,
                  children: ["Used: ", (0, _voicepracticeShared.formatSecondsAsClock)(usedSeconds), "\n", "Included: ", (0, _voicepracticeShared.formatSecondsAsClock)(allotmentSeconds)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2304,
                  columnNumber: 17
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    height: 10,
                    borderRadius: 999,
                    backgroundColor: theme.border,
                    overflow: "hidden",
                    marginTop: 4
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: {
                      width: `${Math.round(usagePct * 100)}%`,
                      height: "100%",
                      backgroundColor: theme.accent
                    }
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2317,
                    columnNumber: 19
                  }, _this4)
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2308,
                  columnNumber: 17
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.body,
                  children: ["Utilization: ", Math.round(usagePct * 100), "%"]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2325,
                  columnNumber: 17
                }, _this4)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 2302,
                columnNumber: 15
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: styles.optionCard,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.optionTitle,
                  children: "Quota Rules"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2329,
                  columnNumber: 17
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.body,
                  children: ["Org daily quota: ", (0, _voicepracticeShared.formatSecondsAsClock)((_usage$dailyQuotaSeco = usage == null ? void 0 : usage.dailyQuotaSeconds) != null ? _usage$dailyQuotaSeco : 0), "\n", "Per-user daily cap: ", (0, _voicepracticeShared.formatSecondsAsClock)((_usage$perUserDailyCa = usage == null ? void 0 : usage.perUserDailyCapSeconds) != null ? _usage$perUserDailyCa : 0), "\n", "Manual bonus pool: ", (0, _voicepracticeShared.formatSecondsAsClock)((_org$manualBonusSecon = org == null ? void 0 : org.manualBonusSeconds) != null ? _org$manualBonusSecon : 0)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2330,
                  columnNumber: 17
                }, _this4)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 2328,
                columnNumber: 15
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2301,
              columnNumber: 13
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2292,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Score Analytics"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2340,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Average score and trends across your organization."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2341,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.hintText,
              children: "Date Range"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2343,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
              horizontal: true,
              showsHorizontalScrollIndicator: false,
              contentContainerStyle: styles.chipRow,
              children: [7, 30, 90].map(function (days) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: [styles.timezoneChip, adminRangeDays === days ? styles.selectedChip : null],
                  onPress: function onPress() {
                    return setAdminRangeDays(days);
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.chipText,
                    children: [days, "d"]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2351,
                    columnNumber: 19
                  }, _this4)
                }, days, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2346,
                  columnNumber: 17
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2344,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                flexDirection: "row",
                gap: 12,
                marginTop: 6,
                flexWrap: "wrap"
              },
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: [styles.optionCard, {
                  flex: 1,
                  minWidth: 160
                }],
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.label,
                  children: "Avg Score"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2358,
                  columnNumber: 17
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.title,
                  children: (orgAdminAnalytics == null ? void 0 : orgAdminAnalytics.orgAvgOverallScore) === null || (orgAdminAnalytics == null ? void 0 : orgAdminAnalytics.orgAvgOverallScore) === undefined ? "-" : orgAdminAnalytics.orgAvgOverallScore.toFixed(1)
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2359,
                  columnNumber: 17
                }, _this4)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 2357,
                columnNumber: 15
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: [styles.optionCard, {
                  flex: 1,
                  minWidth: 160
                }],
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.label,
                  children: "Sessions"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2366,
                  columnNumber: 17
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: styles.title,
                  children: analyticsSessions
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2367,
                  columnNumber: 17
                }, _this4)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 2365,
                columnNumber: 15
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2356,
              columnNumber: 13
            }, _this4), orgAdminAnalytics != null && orgAdminAnalytics.generatedAt ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: ["Updated: ", formatDateLabel(orgAdminAnalytics.generatedAt)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2372,
              columnNumber: 15
            }, _this4) : null]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2339,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Top 5 Scorers"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2377,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Averaged over the selected range."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2378,
              columnNumber: 13
            }, _this4), adminLoading && !orgAdminAnalytics ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.centered,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ActivityIndicator, {
                size: "small",
                color: theme.accent
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2381,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "Loading..."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2382,
                columnNumber: 17
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2380,
              columnNumber: 15
            }, _this4) : ((_orgAdminAnalytics$to = orgAdminAnalytics == null ? void 0 : orgAdminAnalytics.topUsers) != null ? _orgAdminAnalytics$to : []).length === 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "(No score data yet.)"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2385,
              columnNumber: 15
            }, _this4) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                gap: 10,
                marginTop: 6
              },
              children: ((_orgAdminAnalytics$to2 = orgAdminAnalytics == null ? void 0 : orgAdminAnalytics.topUsers) != null ? _orgAdminAnalytics$to2 : []).map(function (row) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: styles.optionCard,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.optionTitle,
                    children: row.email
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2390,
                    columnNumber: 21
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.body,
                    children: ["Avg score: ", row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1), "\n", "Sessions: ", row.sessions]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2391,
                    columnNumber: 21
                  }, _this4)]
                }, row.userId, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2389,
                  columnNumber: 19
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2387,
              columnNumber: 15
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2376,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Trend"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2402,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Daily average score in this range."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2403,
              columnNumber: 13
            }, _this4), adminLoading && !orgAdminAnalytics ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.centered,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ActivityIndicator, {
                size: "small",
                color: theme.accent
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2406,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "Loading..."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2407,
                columnNumber: 17
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2405,
              columnNumber: 15
            }, _this4) : orgAdminAnalytics && orgAdminAnalytics.trendByDay.length > 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                gap: 10,
                marginTop: 6
              },
              children: orgAdminAnalytics.trendByDay.map(function (row) {
                var _row$avgOverallScore3;
                var pct = Math.max(0, Math.min(1, ((_row$avgOverallScore3 = row.avgOverallScore) != null ? _row$avgOverallScore3 : 0) / 100));
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    gap: 6
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: {
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 10
                    },
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: styles.body,
                      children: row.dayKey
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 2416,
                      columnNumber: 25
                    }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: styles.body,
                      children: [row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1), " (", row.sessions, ")"]
                    }, void 0, true, {
                      fileName: _jsxFileName,
                      lineNumber: 2417,
                      columnNumber: 25
                    }, _this4)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2415,
                    columnNumber: 23
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: {
                      height: 10,
                      borderRadius: 999,
                      backgroundColor: theme.border,
                      overflow: "hidden"
                    },
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                      style: {
                        width: `${Math.round(pct * 100)}%`,
                        height: "100%",
                        backgroundColor: theme.accent
                      }
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 2429,
                      columnNumber: 25
                    }, _this4)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2421,
                    columnNumber: 23
                  }, _this4)]
                }, row.dayKey, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2414,
                  columnNumber: 21
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2410,
              columnNumber: 15
            }, _this4) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "(No scored sessions yet.)"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2442,
              columnNumber: 15
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2401,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "By Role"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2447,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Average scores by role segment (and mapped industry)."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2448,
              columnNumber: 13
            }, _this4), ((_orgAdminAnalytics$by2 = orgAdminAnalytics == null ? void 0 : orgAdminAnalytics.bySegment) != null ? _orgAdminAnalytics$by2 : []).length === 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "(No role data yet.)"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2450,
              columnNumber: 15
            }, _this4) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                gap: 10,
                marginTop: 6
              },
              children: ((_orgAdminAnalytics$by3 = orgAdminAnalytics == null ? void 0 : orgAdminAnalytics.bySegment) != null ? _orgAdminAnalytics$by3 : []).map(function (row) {
                var industryId = industryIdByRoleSegmentId.get(row.segmentId);
                var industryLabel = industryId ? _voicepracticeShared.INDUSTRY_LABELS[industryId] : null;
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: styles.optionCard,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.optionTitle,
                    children: industryLabel ? `${industryLabel} - ${row.segmentLabel}` : row.segmentLabel
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2458,
                    columnNumber: 23
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.body,
                    children: ["Avg score: ", row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1), "\n", "Sessions: ", row.sessions]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2461,
                    columnNumber: 23
                  }, _this4)]
                }, row.segmentId, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2457,
                  columnNumber: 21
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2452,
              columnNumber: 15
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2446,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "By Industry"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2473,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Roll-up across roles inside each industry."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2474,
              columnNumber: 13
            }, _this4), byIndustry.length === 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "(No industry data yet.)"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2476,
              columnNumber: 15
            }, _this4) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                gap: 10,
                marginTop: 6
              },
              children: byIndustry.map(function (row) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: styles.optionCard,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.optionTitle,
                    children: row.industryLabel
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2481,
                    columnNumber: 21
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.body,
                    children: ["Avg score: ", row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1), "\n", "Sessions: ", row.sessions]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2482,
                    columnNumber: 21
                  }, _this4)]
                }, row.industryId, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2480,
                  columnNumber: 19
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2478,
              columnNumber: 15
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2472,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.primaryButton,
            onPress: function onPress() {
              return setScreen("admin_user_list");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.primaryButtonText,
              children: "Manage Users"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2493,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2492,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2285,
          columnNumber: 9
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 2270,
        columnNumber: 7
      }, _this4);
    };
    var renderAdminUserList = function renderAdminUserList() {
      var _orgAdminUsers$users;
      if (!hasAdminAccess || !user) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.centered,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.errorText,
            children: "Admin access required."
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2504,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.primaryButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.primaryButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2506,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2505,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2503,
          columnNumber: 9
        }, _this4);
      }
      var formatRole = function formatRole(role) {
        var _role;
        return (_role = _voicepracticeShared.ORG_USER_ROLE_LABELS[role]) != null ? _role : role;
      };
      var formatStatus = function formatStatus(status) {
        return status === "disabled" ? "Locked" : "Active";
      };
      var allUsers = (_orgAdminUsers$users = orgAdminUsers == null ? void 0 : orgAdminUsers.users) != null ? _orgAdminUsers$users : [];
      var filteredUsers = allUsers.filter(function (row) {
        if (adminUserStatusFilter === "active") {
          return row.status === "active";
        }
        if (adminUserStatusFilter === "locked") {
          return row.status !== "active";
        }
        return true;
      });
      var userOptions = filteredUsers.slice().sort(function (a, b) {
        return a.email.localeCompare(b.email);
      }).map(function (row) {
        return {
          value: row.userId,
          label: `${row.email} (${formatRole(row.orgRole)} - ${formatStatus(row.status)})`
        };
      });
      var goToUser = function goToUser(userId) {
        setSelectedAdminUserId(userId);
        setOrgAdminUserDetail(null);
        setAdminError(null);
        setScreen("admin_user_detail");
      };
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: styles.fill,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.ghostButton,
            onPress: function onPress() {
              return setScreen("admin_home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2546,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2545,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "Users"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2548,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: [styles.ghostButton, adminLoading ? styles.disabled : null],
            disabled: adminLoading,
            onPress: function onPress() {
              return void refreshOrgAdminUsers();
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: adminLoading ? "Loading..." : "Refresh"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2554,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2549,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2544,
          columnNumber: 9
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: styles.scroll,
          contentContainerStyle: styles.scrollContent,
          children: [adminError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.errorCard,
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.errorText,
              children: adminError
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2561,
              columnNumber: 15
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2560,
            columnNumber: 13
          }, _this4) : null, /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Select A User"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2566,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Search by email, then open their dashboard to review and lock access."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2567,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.hintText,
              children: "Filter"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2569,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
              horizontal: true,
              showsHorizontalScrollIndicator: false,
              contentContainerStyle: styles.chipRow,
              children: [{
                id: "active",
                label: "Active"
              }, {
                id: "locked",
                label: "Locked"
              }, {
                id: "all",
                label: "All"
              }].map(function (option) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: [styles.timezoneChip, adminUserStatusFilter === option.id ? styles.selectedChip : null],
                  onPress: function onPress() {
                    return setAdminUserStatusFilter(option.id);
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.chipText,
                    children: option.label
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2581,
                    columnNumber: 19
                  }, _this4)
                }, option.id, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2576,
                  columnNumber: 17
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2570,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.hintText,
              children: "User"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2586,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(SearchableSelectionDropdown, {
              value: selectedAdminUserId,
              options: userOptions,
              onChange: function onChange(value) {
                return goToUser(value);
              },
              placeholder: "Select user",
              title: "User",
              searchPlaceholder: "Search by email...",
              styles: styles
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2587,
              columnNumber: 13
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2565,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.card,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.title,
              children: "Directory"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2599,
              columnNumber: 13
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Tap a user to open details."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2600,
              columnNumber: 13
            }, _this4), adminLoading && !orgAdminUsers ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.centered,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ActivityIndicator, {
                size: "small",
                color: theme.accent
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2604,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "Loading users..."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2605,
                columnNumber: 17
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2603,
              columnNumber: 15
            }, _this4) : filteredUsers.length === 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "(No users match this filter.)"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2608,
              columnNumber: 15
            }, _this4) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                gap: 10,
                marginTop: 6
              },
              children: filteredUsers.slice().sort(function (a, b) {
                return a.email.localeCompare(b.email);
              }).map(function (row) {
                return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: styles.optionCard,
                  onPress: function onPress() {
                    return goToUser(row.userId);
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.optionTitle,
                    children: row.email
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2616,
                    columnNumber: 23
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.body,
                    children: ["Role: ", formatRole(row.orgRole), "\n", "Status: ", formatStatus(row.status)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2617,
                    columnNumber: 23
                  }, _this4)]
                }, row.userId, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2615,
                  columnNumber: 21
                }, _this4);
              })
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2610,
              columnNumber: 15
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2598,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2558,
          columnNumber: 9
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 2543,
        columnNumber: 7
      }, _this4);
    };
    var renderAdminUserDetail = function renderAdminUserDetail() {
      var _orgAdminUserDetail$u, _detail$user$orgRole;
      if (!hasAdminAccess || !user) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.centered,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.errorText,
            children: "Admin access required."
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2635,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.primaryButton,
            onPress: function onPress() {
              return setScreen("home");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.primaryButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2637,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2636,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2634,
          columnNumber: 9
        }, _this4);
      }
      var targetUserId = selectedAdminUserId.trim();
      if (!targetUserId) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.centered,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.errorText,
            children: "Select a user to view details."
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2647,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.primaryButton,
            onPress: function onPress() {
              return setScreen("admin_user_list");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.primaryButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2649,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2648,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2646,
          columnNumber: 9
        }, _this4);
      }
      var detail = (orgAdminUserDetail == null || (_orgAdminUserDetail$u = orgAdminUserDetail.user) == null ? void 0 : _orgAdminUserDetail$u.userId) === targetUserId ? orgAdminUserDetail : null;
      var actorIsTarget = user.id === targetUserId;
      var actorIsUserAdmin = user.orgRole === "user_admin";
      var targetIsOrgAdmin = detail ? detail.user.orgRole === "org_admin" : false;
      var locked = detail ? detail.user.status !== "active" : false;
      var roleLabel = detail ? (_detail$user$orgRole = _voicepracticeShared.ORG_USER_ROLE_LABELS[detail.user.orgRole]) != null ? _detail$user$orgRole : detail.user.orgRole : "-";
      var accessControlsDisabled = actorIsTarget || actorIsUserAdmin && targetIsOrgAdmin;
      var setLocked = function setLocked(nextLocked) {
        if (adminLoading) {
          return;
        }
        if (actorIsTarget) {
          setAdminError("You cannot lock or unlock your own account.");
          return;
        }
        if (actorIsUserAdmin && targetIsOrgAdmin) {
          setAdminError("User admins cannot lock or unlock org admins.");
          return;
        }
        if (detail && nextLocked === locked) {
          return;
        }
        void setOrgUserLocked(targetUserId, nextLocked);
      };
      return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: styles.fill,
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.topRow,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.ghostButton,
            onPress: function onPress() {
              return setScreen("admin_user_list");
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: "Back"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2687,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2686,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.topTitle,
            children: "User"
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2689,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: [styles.ghostButton, adminLoading ? styles.disabled : null],
            disabled: adminLoading,
            onPress: function onPress() {
              return void refreshOrgAdminUserDetail(targetUserId);
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.ghostButtonText,
              children: adminLoading ? "Loading..." : "Refresh"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2695,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2690,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2685,
          columnNumber: 9
        }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: styles.scroll,
          contentContainerStyle: styles.scrollContent,
          children: [adminError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.errorCard,
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.errorText,
              children: adminError
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2702,
              columnNumber: 15
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2701,
            columnNumber: 13
          }, _this4) : null, !detail ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
            style: styles.centered,
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ActivityIndicator, {
              size: "large",
              color: theme.accent
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2708,
              columnNumber: 15
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.body,
              children: "Loading user details..."
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2709,
              columnNumber: 15
            }, _this4)]
          }, void 0, true, {
            fileName: _jsxFileName,
            lineNumber: 2707,
            columnNumber: 13
          }, _this4) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.card,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.label,
                children: "User"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2714,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.title,
                children: detail.user.email
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2715,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: ["Role: ", roleLabel, "\n", "Status: ", detail.user.status === "disabled" ? "Locked" : "Active"]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 2716,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.hintText,
                children: "Access"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2721,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
                horizontal: true,
                showsHorizontalScrollIndicator: false,
                contentContainerStyle: styles.chipRow,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: [styles.timezoneChip, !locked ? styles.selectedChip : null, accessControlsDisabled ? styles.disabled : null],
                  disabled: accessControlsDisabled,
                  onPress: function onPress() {
                    return setLocked(false);
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.chipText,
                    children: "Active"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2732,
                    columnNumber: 21
                  }, _this4)
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2723,
                  columnNumber: 19
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
                  style: [styles.timezoneChip, locked ? styles.selectedChip : null, accessControlsDisabled ? styles.disabled : null],
                  disabled: accessControlsDisabled,
                  onPress: function onPress() {
                    return setLocked(true);
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.chipText,
                    children: "Locked"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2743,
                    columnNumber: 21
                  }, _this4)
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 2734,
                  columnNumber: 19
                }, _this4)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 2722,
                columnNumber: 17
              }, _this4), actorIsTarget ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "You cannot lock yourself out from within the app."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2747,
                columnNumber: 19
              }, _this4) : actorIsUserAdmin && targetIsOrgAdmin ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "User Admins cannot lock or unlock Org Admins."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2749,
                columnNumber: 19
              }, _this4) : null]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2713,
              columnNumber: 15
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.card,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.title,
                children: "Activity"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2754,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: ["Range: ", formatDateLabel(detail.period.startAt), " to ", formatDateLabel(detail.period.endAt)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 2755,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: {
                  flexDirection: "row",
                  gap: 12,
                  marginTop: 6,
                  flexWrap: "wrap"
                },
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: [styles.optionCard, {
                    flex: 1,
                    minWidth: 160
                  }],
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.label,
                    children: "Sessions"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2760,
                    columnNumber: 21
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.title,
                    children: detail.usage.sessions
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2761,
                    columnNumber: 21
                  }, _this4)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2759,
                  columnNumber: 19
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: [styles.optionCard, {
                    flex: 1,
                    minWidth: 160
                  }],
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.label,
                    children: "Billed"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2764,
                    columnNumber: 21
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.title,
                    children: [(0, _voicepracticeShared.secondsToWholeMinutes)(detail.usage.billedSeconds), "m"]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2765,
                    columnNumber: 21
                  }, _this4)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2763,
                  columnNumber: 19
                }, _this4)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 2758,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: {
                  flexDirection: "row",
                  gap: 12,
                  marginTop: 6,
                  flexWrap: "wrap"
                },
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: [styles.optionCard, {
                    flex: 1,
                    minWidth: 160
                  }],
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.label,
                    children: "Avg Score"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2770,
                    columnNumber: 21
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.title,
                    children: detail.scores.avgOverallScore === null ? "-" : detail.scores.avgOverallScore.toFixed(1)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2771,
                    columnNumber: 21
                  }, _this4)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2769,
                  columnNumber: 19
                }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: [styles.optionCard, {
                    flex: 1,
                    minWidth: 160
                  }],
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.label,
                    children: "Scored"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2776,
                    columnNumber: 21
                  }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: styles.title,
                    children: detail.scores.sessions
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 2777,
                    columnNumber: 21
                  }, _this4)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 2775,
                  columnNumber: 19
                }, _this4)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 2768,
                columnNumber: 17
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2753,
              columnNumber: 15
            }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: styles.card,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.title,
                children: "Recent Scores"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2783,
                columnNumber: 17
              }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "Most recent scored sessions in the last 30 days."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2784,
                columnNumber: 17
              }, _this4), detail.scores.recent.length === 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: styles.body,
                children: "(No scored sessions in this period.)"
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2786,
                columnNumber: 19
              }, _this4) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: {
                  gap: 10,
                  marginTop: 6
                },
                children: detail.scores.recent.map(function (row) {
                  var _segmentLabelById$get2, _scenarioTitleById$ge2;
                  return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: styles.optionCard,
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: styles.optionTitle,
                      children: ["Score: ", row.overallScore]
                    }, void 0, true, {
                      fileName: _jsxFileName,
                      lineNumber: 2791,
                      columnNumber: 25
                    }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: styles.body,
                      children: [formatDateLabel(row.endedAt), "\n", "Segment: ", (_segmentLabelById$get2 = segmentLabelById.get(row.segmentId)) != null ? _segmentLabelById$get2 : row.segmentId, "\n", "Scenario: ", (_scenarioTitleById$ge2 = scenarioTitleById.get(row.scenarioId)) != null ? _scenarioTitleById$ge2 : row.scenarioId]
                    }, void 0, true, {
                      fileName: _jsxFileName,
                      lineNumber: 2792,
                      columnNumber: 25
                    }, _this4)]
                  }, row.id, true, {
                    fileName: _jsxFileName,
                    lineNumber: 2790,
                    columnNumber: 23
                  }, _this4);
                })
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 2788,
                columnNumber: 19
              }, _this4)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 2782,
              columnNumber: 15
            }, _this4)]
          }, void 0, true)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2699,
          columnNumber: 9
        }, _this4)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 2684,
        columnNumber: 7
      }, _this4);
    };
    var renderContent = function renderContent() {
      if (isBootLoading) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.centered,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ActivityIndicator, {
            size: "large",
            color: theme.accent
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2813,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.body,
            children: "Loading app..."
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2814,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2812,
          columnNumber: 9
        }, _this4);
      }
      if (appError) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: styles.centered,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: styles.errorText,
            children: appError
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2822,
            columnNumber: 11
          }, _this4), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Pressable, {
            style: styles.primaryButton,
            onPress: function onPress() {
              void initializeApp();
            },
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
              style: styles.primaryButtonText,
              children: "Retry"
            }, void 0, false, {
              fileName: _jsxFileName,
              lineNumber: 2824,
              columnNumber: 13
            }, _this4)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 2823,
            columnNumber: 11
          }, _this4)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 2821,
          columnNumber: 9
        }, _this4);
      }
      if (screen === "onboarding") {
        return renderOnboarding();
      }
      if (screen === "simulation" && simulationConfig) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_srcScreensSimulationScreen.SimulationScreen, {
          config: simulationConfig,
          onExit: function onExit() {
            setSimulationConfig(null);
            setScreen("setup");
          },
          onSessionComplete: handleSessionComplete
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 2836,
          columnNumber: 9
        }, _this4);
      }
      if (screen === "scorecard" && lastCompletedConfig) {
        return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_srcScreensScorecardView.ScorecardView, {
          title: lastCompletedConfig.scenario.title,
          segmentLabel: lastCompletedConfig.segmentLabel,
          difficulty: lastCompletedConfig.difficulty,
          personaStyle: lastCompletedConfig.personaStyle,
          scorecard: scorecard,
          isLoading: isScoring,
          error: scorecardError,
          onBack: function onBack() {
            return setScreen("setup");
          }
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 2849,
          columnNumber: 9
        }, _this4);
      }
      if (screen === "usage_dashboard") {
        return renderUsageDashboard();
      }
      if (screen === "admin_home") {
        return renderAdminHome();
      }
      if (screen === "admin_org_dashboard") {
        return renderAdminOrgDashboard();
      }
      if (screen === "admin_user_list") {
        return renderAdminUserList();
      }
      if (screen === "admin_user_detail") {
        return renderAdminUserDetail();
      }
      if (screen === "setup") {
        return renderSetup();
      }
      if (screen === "settings") {
        return renderSettings();
      }
      if (screen === "profile") {
        return renderProfile();
      }
      if (screen === "subscription") {
        return renderSubscription();
      }
      return renderHome();
    };
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNativeSafeAreaContext.SafeAreaProvider, {
      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoStatusBar.StatusBar, {
        style: statusBarStyle
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 2903,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoLinearGradient.LinearGradient, {
        colors: [theme.bgTop, theme.bgBottom],
        style: styles.gradient,
        children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNativeSafeAreaContext.SafeAreaView, {
          style: styles.safeArea,
          children: renderContent()
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 2905,
          columnNumber: 9
        }, this)
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 2904,
        columnNumber: 7
      }, this)]
    }, void 0, true, {
      fileName: _jsxFileName,
      lineNumber: 2902,
      columnNumber: 5
    }, this);
  }
  _s4(App, "oFcbISd7m9yl0TQCTgTo/tjscJo=");
  _c4 = App;
  function createStyles(theme) {
    return _reactNative.StyleSheet.create({
      gradient: {
        flex: 1
      },
      safeArea: {
        flex: 1,
        paddingHorizontal: 16,
        paddingBottom: 12
      },
      fill: {
        flex: 1
      },
      centered: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        gap: 12
      },
      topRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12
      },
      spacer: {
        width: 84
      },
      topTitle: {
        color: theme.text,
        fontSize: 19,
        fontWeight: "700"
      },
      card: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.panel,
        padding: 15,
        marginBottom: 14,
        gap: 9
      },
      heroCard: {
        borderRadius: 26,
        borderWidth: 1.5,
        borderColor: theme.accent,
        paddingHorizontal: 18,
        paddingVertical: 18,
        marginBottom: 18,
        overflow: "hidden",
        gap: 8,
        shadowColor: theme.accent,
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: {
          width: 0,
          height: 6
        },
        elevation: 5
      },
      heroGlowOne: {
        position: "absolute",
        width: 220,
        height: 220,
        borderRadius: 999,
        backgroundColor: "rgba(255, 255, 255, 0.16)",
        top: -110,
        right: -85
      },
      heroGlowTwo: {
        position: "absolute",
        width: 150,
        height: 150,
        borderRadius: 999,
        backgroundColor: "rgba(53, 194, 255, 0.18)",
        bottom: -60,
        left: -45
      },
      heroTitle: {
        color: theme.text,
        fontSize: 42,
        fontWeight: "900",
        lineHeight: 44,
        letterSpacing: -0.5
      },
      heroRule: {
        width: 118,
        height: 4,
        borderRadius: 99,
        backgroundColor: theme.accent,
        opacity: 0.88,
        marginVertical: 2
      },
      heroSubtitle: {
        color: theme.text,
        fontSize: 21,
        fontWeight: "800",
        lineHeight: 26
      },
      heroBody: {
        color: theme.textMuted,
        fontSize: 14.5,
        lineHeight: 21
      },
      heroChipRow: {
        flexDirection: "row",
        gap: 8,
        marginTop: 4
      },
      heroChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: "rgba(255, 255, 255, 0.28)",
        paddingHorizontal: 10,
        paddingVertical: 5
      },
      heroChipText: {
        color: theme.text,
        fontSize: 11.5,
        fontWeight: "700"
      },
      segmentCard: {
        marginTop: 10,
        borderColor: theme.accent,
        backgroundColor: theme.currentPlanCardBg
      },
      segmentLabel: {
        color: theme.accent,
        fontSize: 12,
        fontWeight: "800",
        textTransform: "uppercase",
        letterSpacing: 0.7
      },
      segmentTitle: {
        color: theme.text,
        fontSize: 24,
        fontWeight: "800",
        lineHeight: 28
      },
      title: {
        color: theme.text,
        fontSize: 23,
        fontWeight: "700"
      },
      label: {
        color: theme.accent,
        fontSize: 12,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 0.6
      },
      body: {
        color: theme.textMuted,
        fontSize: 14.5,
        lineHeight: 21
      },
      hintText: {
        color: theme.hint,
        fontSize: 12,
        marginTop: 8
      },
      sectionTitle: {
        color: theme.text,
        fontSize: 19,
        fontWeight: "700",
        marginTop: 4,
        marginBottom: 10
      },
      scroll: {
        flex: 1
      },
      scrollContent: {
        paddingBottom: 24
      },
      ghostButton: {
        minWidth: 84,
        height: 38,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.ghostButtonBg
      },
      ghostButtonText: {
        color: theme.text,
        fontSize: 14,
        fontWeight: "700"
      },
      menuButton: {
        width: 84,
        height: 38,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.ghostButtonBg
      },
      menuButtonText: {
        color: theme.text,
        fontSize: 14,
        fontWeight: "700"
      },
      menuOverlayRoot: {
        flex: 1,
        justifyContent: "flex-start",
        alignItems: "flex-end",
        paddingTop: 72,
        paddingHorizontal: 16
      },
      menuOverlayBackdrop: Object.assign({}, _reactNative.StyleSheet.absoluteFillObject, {
        backgroundColor: theme.menuOverlayBackdrop
      }),
      menuOverlayCard: {
        width: "86%",
        maxWidth: 360,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.menuOverlayCardBg,
        padding: 12,
        gap: 6
      },
      menuHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 2
      },
      menuHeading: {
        color: theme.text,
        fontSize: 15,
        fontWeight: "700"
      },
      menuCloseButton: {
        width: 30,
        height: 30,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.menuCloseBg
      },
      menuCloseButtonText: {
        color: theme.text,
        fontSize: 13,
        fontWeight: "700"
      },
      menuBody: {
        color: theme.textMuted,
        fontSize: 13,
        lineHeight: 18
      },
      menuSeparator: {
        height: 1,
        backgroundColor: theme.border,
        marginVertical: 4
      },
      menuItemButton: {
        minHeight: 40,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.menuItemBg,
        marginTop: 4
      },
      menuItemText: {
        color: theme.text,
        fontSize: 13,
        fontWeight: "700"
      },
      optionCard: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.panel,
        padding: 12,
        marginBottom: 8,
        gap: 6
      },
      selectedCard: {
        borderColor: theme.accent,
        backgroundColor: theme.selectedCardBg
      },
      currentPlanCard: {
        borderColor: theme.accent,
        backgroundColor: theme.currentPlanCardBg
      },
      planRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10
      },
      planBadge: {
        color: theme.planBadgeText,
        backgroundColor: theme.accent,
        fontSize: 11,
        fontWeight: "800",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999
      },
      optionTitle: {
        color: theme.text,
        fontSize: 16,
        fontWeight: "700"
      },
      input: {
        height: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.inputBg,
        color: theme.text,
        paddingHorizontal: 12,
        fontSize: 16,
        marginTop: 8
      },
      inlineActionButton: {
        minHeight: 36,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.inlineButtonBg,
        paddingHorizontal: 10,
        marginTop: 8
      },
      inlineActionButtonText: {
        color: theme.text,
        fontSize: 12.5,
        fontWeight: "700"
      },
      dropdownWrapper: {
        marginTop: 6
      },
      dropdownTrigger: {
        height: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.dropdownBg,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between"
      },
      dropdownValue: {
        color: theme.text,
        fontSize: 15,
        flex: 1,
        paddingRight: 12
      },
      dropdownChevron: {
        color: theme.dropdownChevron,
        fontSize: 18,
        fontWeight: "700"
      },
      dropdownModalRoot: {
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: 18
      },
      dropdownModalBackdrop: Object.assign({}, _reactNative.StyleSheet.absoluteFillObject, {
        backgroundColor: theme.dropdownModalBackdrop
      }),
      dropdownModalCard: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.dropdownModalCardBg,
        maxHeight: 460,
        padding: 12
      },
      dropdownModalTitle: {
        color: theme.text,
        fontSize: 16,
        fontWeight: "700",
        marginBottom: 10
      },
      dropdownOptionsScroll: {
        maxHeight: 390
      },
      dropdownOptionsContent: {
        gap: 6
      },
      dropdownOption: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.border,
        paddingHorizontal: 10,
        paddingVertical: 10,
        backgroundColor: theme.dropdownOptionBg
      },
      dropdownOptionSelected: {
        borderColor: theme.accent,
        backgroundColor: theme.dropdownOptionSelectedBg
      },
      dropdownOptionText: {
        color: theme.text,
        fontSize: 13
      },
      dropdownOptionTextSelected: {
        fontWeight: "700"
      },
      warningCard: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.warningBorder,
        backgroundColor: theme.warningBg,
        padding: 12,
        marginBottom: 12
      },
      warningText: {
        color: theme.warningText,
        fontSize: 13.5,
        lineHeight: 19
      },
      errorCard: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.errorCardBorder,
        backgroundColor: theme.errorCardBg,
        padding: 12,
        marginBottom: 12
      },
      errorText: {
        color: theme.danger,
        fontSize: 13,
        marginBottom: 6
      },
      successText: {
        color: theme.success,
        fontSize: 13,
        marginBottom: 6
      },
      primaryButton: {
        minHeight: 52,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.accent
      },
      primaryButtonText: {
        color: theme.primaryButtonText,
        fontSize: 16,
        fontWeight: "800"
      },
      disabled: {
        opacity: 0.55
      },
      chipRow: {
        gap: 8,
        paddingVertical: 8
      },
      timezoneChip: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.dropdownOptionBg
      },
      selectedChip: {
        borderColor: theme.accent,
        backgroundColor: theme.dropdownOptionSelectedBg
      },
      chipText: {
        color: theme.text,
        fontSize: 12,
        fontWeight: "600"
      },
      linkButton: {
        minHeight: 42,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.linkButtonBg,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 8,
        paddingHorizontal: 10
      },
      linkButtonText: {
        color: theme.text,
        fontSize: 13,
        fontWeight: "700"
      },
      voiceToggleRow: {
        flexDirection: "row",
        gap: 8,
        marginBottom: 8
      },
      voiceToggleButton: {
        flex: 1,
        minHeight: 42,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.panel
      },
      voiceToggleText: {
        color: theme.text,
        fontSize: 13.5,
        fontWeight: "700"
      },
      signOutButton: {
        marginTop: 6,
        marginBottom: 18
      }
    });
  }
  var _c, _c2, _c3, _c4;
  $RefreshReg$(_c, "TimezoneDropdown");
  $RefreshReg$(_c2, "SelectionDropdown");
  $RefreshReg$(_c3, "SearchableSelectionDropdown");
  $RefreshReg$(_c4, "App");
},0,[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18],"App.tsx");
//# sourceMappingURL=http://127.0.0.1:8081/mobile/App.map?platform=android&dev=true&hot=false&lazy=true&minify=false&modulesOnly=true&runModule=false&shallow=true
//# sourceURL=http://127.0.0.1:8081/mobile/App.bundle//&platform=android&dev=true&hot=false&lazy=true&minify=false&modulesOnly=true&runModule=false&shallow=true