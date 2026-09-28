/*
 * FEDERaiDE Mobile is an android app that runs the federaide harness with appropriate UI.
 * Copyright (C) 2026-2027  ROCK LAB PRIVATE LIMITED
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useShareIntent } from 'expo-share-intent';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';

// Configure system notification presentation
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldVibrate: true,
  }),
});

// Strips Markdown, LaTeX, and Rich terminal tags into clean plain text for Android notification banners
function sanitizeForNotification(raw, maxLength = 140) {
  if (!raw) return '';
  let text = String(raw);

  text = text
    .replace(/```[\s\S]*?```/g, '[Code]')                     // Replace multiline code blocks
    .replace(/`([^`]+)`/g, '$1')                              // Inline code backticks
    .replace(/!\[(.*?)\]\([^)]*\)/g, '')                      // Markdown images
    .replace(/\[(.*?)\]\([^)]*\)/g, '$1')                     // Markdown links [text](url) -> text
    .replace(/\$\$[\s\S]*?\$\$/g, '[Equation]')               // Block LaTeX
    .replace(/\$([^\$\n]+)\$/g, '$1')                         // Inline LaTeX
    .replace(/\[\/?(bold|dim|italic|underline|\#[a-fA-F0-9]{6}|[a-zA-Z]+)(?:\s+[a-zA-Z0-9#_]+)?\]/gi, '') // Terminal tags
    .replace(/^#{1,6}\s+/gm, '')                              // Headers (#, ##, ###)
    .replace(/(\*\*|__)(.*?)\1/g, '$2')                       // Bold (**text**)
    .replace(/(\*|_)(.*?)\1/g, '$2')                         // Italics (*text*)
    .replace(/~~(.*?)~~/g, '$1')                              // Strikethrough (~~text~~)
    .replace(/^>\s+/gm, '')                                   // Blockquotes (>)
    .replace(/^[*\-_]{3,}\s*$/gm, '')                         // Horizontal rules (---, ***)
    .replace(/^[\*\-+]\s+/gm, '• ')                           // Unordered list items
    .replace(/^\d+\.\s+/gm, '')                               // Ordered list numbers
    .replace(/\s+/g, ' ')                                     // Collapse linebreaks and excess spaces
    .trim();

  return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
}

async function triggerBackgroundNotification(title, body) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: title || 'FEDERaiDE Agent Alert',
        body: sanitizeForNotification(body) || 'Your agent completed a task.',
        sound: 'default',
      },
      trigger: null, // deliver immediately
    });
  } catch (e) {
    console.warn('[Notification Error]', e);
  }
}

import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Linking,
  Platform,
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  ScrollView,
  AppState,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { NativeModules } from 'react-native';
import Constants from 'expo-constants';
import { requireNativeModule, EventEmitter } from 'expo-modules-core';

let TermuxNative = null;
let termuxEmitter = null;
try {
  TermuxNative = requireNativeModule('TermuxNative');
  termuxEmitter = new EventEmitter(TermuxNative);
} catch (e) {
  // Fallback if legacy bridge is active
  TermuxNative = NativeModules.TermuxNative || null;
}

// --- EMBEDDED COMPLETE REFERENCE UI (HTML5 + CSS3 + KATEX + HIGHLIGHT.JS + MODALS) ---
const COMPLETE_CLIENT_HTML = `
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content">
    <title>FEDERaiDE Mobile</title>
    <!-- Highlight.js Tokyo Night Theme -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/tokyo-night-dark.min.css">
    <!-- KaTeX Stylesheet for Mathematical Equations -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
    <!-- Typography -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Michroma&family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
    
    <!-- Dependencies (KaTeX, Auto-Render, Marked, Marked-KaTeX, Highlight.js) -->
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked-katex-extension@5.1.2/lib/index.umd.js"></script>

    <style>
        :root[data-theme="dark"] {
            --bg-base: #060709;
            --bg-surface: #0e1015;
            --bg-card: #151821;
            --bg-hover: #1f2330;
            --border-subtle: rgba(255, 255, 255, 0.08);
            --border-focus: #3ddbd9;
            --text-main: #f0f2f5;
            --text-muted: #8b92a5;
            --text-dim: #5c6275;
            --user-bubble-bg: #151821;
            --code-block-bg: #090a0d;
        }

        :root[data-theme="light"] {
            --bg-base: #f8f9fa;
            --bg-surface: #ffffff;
            --bg-card: #f0f4f9;
            --bg-hover: #e3e7ed;
            --border-subtle: rgba(0, 0, 0, 0.09);
            --border-focus: #3ddbd9;
            --text-main: #1f1f1f;
            --text-muted: #444746;
            --text-dim: #747775;
            --user-bubble-bg: #e5ebf5;
            --code-block-bg: #eef1f6;
        }

        :root {
            --brand-primary: #3ddbd9;
            --brand-teal: #3ddbd9;
            --brand-green: #8cc84b;
            --brand-yellow: #f2a813;
            --brand-orange: #e98435;
            --brand-red: #da6057;
            --font-display: 'Michroma', sans-serif;
            --font-sans: 'Space Grotesk', -apple-system, sans-serif;
            --font-mono: 'Space Mono', monospace;
            --drawer-width: 290px;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        
        html, body {
            background-color: var(--bg-base);
            color: var(--text-main);
            font-family: var(--font-sans);
            height: 100%;
            width: 100%;
            position: fixed;
            inset: 0;
            overflow: hidden;
            overscroll-behavior: none;
            -webkit-overscroll-behavior: none;
            user-select: none;
            -webkit-user-select: none;
            transition: background-color 0.2s ease, color 0.2s ease;
        }
        body {
            display: flex;
        }

        /* --- SIDEBAR / DRAWER --- */
        #sidebar-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(4px);
            z-index: 900;
            display: none;
            opacity: 0;
            transition: opacity 0.25s ease;
        }
        #sidebar-overlay.active { display: block; opacity: 1; }

        #sidebar {
            width: var(--drawer-width);
            height: 100vh;
            background: var(--bg-surface);
            border-right: 1px solid var(--border-subtle);
            position: fixed;
            top: 0;
            left: 0;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            transform: translateX(-100%);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            box-shadow: none;
        }
        #sidebar.open { transform: translateX(0); }

        .sidebar-header {
            padding: 1.25rem 1.25rem 0.75rem 1.25rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .sidebar-brand {
            font-family: var(--font-display);
            font-size: 1.15rem;
            color: var(--brand-red);
            display: flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
        }
        .sidebar-brand::before { content: '>'; color: var(--brand-yellow); font-weight: bold; }

        .btn-new-chat-tray {
            margin: 0.75rem 1.25rem;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            color: var(--text-main);
            padding: 0.75rem 1rem;
            border-radius: 24px;
            font-size: 0.9rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .btn-new-chat-tray:hover {
            background: var(--bg-hover);
            border-color: var(--border-focus);
            transform: translateY(-1px);
        }

        .sidebar-scroll {
            flex: 1;
            overflow-y: auto;
            padding: 0.5rem 1.25rem;
            scrollbar-width: thin;
        }

        .sidebar-section-title {
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--text-dim);
            margin: 1.25rem 0 0.5rem 0;
        }

        .recents-list { display: flex; flex-direction: column; gap: 2px; }
        .recent-chat-item {
            padding: 0.6rem 0.75rem;
            border-radius: 10px;
            font-size: 0.85rem;
            color: var(--text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
        }
        .recent-chat-item:hover, .recent-chat-item.active {
            background: var(--bg-card);
            color: var(--text-main);
        }

        .btn-toggle-all-chats {
            font-size: 0.8rem;
            color: var(--brand-primary);
            background: none;
            border: none;
            padding: 0.5rem 0.75rem;
            text-align: left;
            cursor: pointer;
            margin-top: 4px;
        }

        .sidebar-footer {
            padding: 1rem 1.25rem calc(1.75rem + env(safe-area-inset-bottom, 16px)) 1.25rem;
            border-top: 1px solid var(--border-subtle);
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .tray-action-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 0.4rem 0;
            cursor: pointer;
        }
        .tray-action-btn:hover { color: var(--text-main); }
        .tray-action-btn svg { width: 16px; height: 16px; fill: currentColor; }

        /* --- MAIN APP VIEWPORT --- */
        #app-main {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            height: 100vh;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: var(--bg-base);
            min-width: 0;
            overflow: hidden;
            overscroll-behavior: none;
            -webkit-overscroll-behavior: none;
        }

        header {
            flex-shrink: 0;
            height: 56px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 1rem;
            z-index: 200;
            background: linear-gradient(to bottom, var(--bg-base) 45%, transparent);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            mask-image: linear-gradient(to bottom, black 60%, transparent);
            -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent);
            border-bottom: none;
            position: relative;
            touch-action: none;
        }
        .header-left { display: flex; align-items: center; gap: 10px; position: relative; }
        .header-center {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .icon-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }
        .icon-btn svg { width: 20px; height: 20px; fill: currentColor; }

        .model-selector-pill {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0.35rem 0.8rem;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
        }
        .model-selector-pill .agent-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--brand-teal);
        }

        #header-agent-dropdown {
            display: none;
            position: fixed;
            top: 54px;
            left: 1rem;
            width: 280px;
            max-height: 380px;
            background: var(--bg-surface);
            border: 1.5px solid var(--border-focus);
            border-radius: 16px;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.95);
            z-index: 2500;
            padding: 0.75rem;
            flex-direction: column;
            gap: 6px;
        }
        #header-agent-dropdown.open { display: flex; }
        .dropdown-search-input {
            width: 100%;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            color: var(--text-main);
            padding: 0.5rem 0.75rem;
            border-radius: 8px;
            font-size: 0.82rem;
            outline: none;
        }
        .dropdown-agents-list {
            max-height: 220px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .dropdown-agent-item {
            padding: 0.5rem 0.75rem;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            font-size: 0.85rem;
        }
        .dropdown-agent-item:hover, .dropdown-agent-item.active { background: var(--bg-hover); }

        .header-right { display: flex; align-items: center; gap: 8px; }
        .badge-pill {
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 700;
            font-family: var(--font-mono);
            cursor: pointer;
        }
        .mode-plan { background: rgba(140, 200, 75, 0.15); color: var(--brand-green); border: 1px solid var(--brand-green); }
        .mode-intermediate { background: rgba(233, 132, 53, 0.15); color: var(--brand-orange); border: 1px solid var(--brand-orange); }
        .mode-execute { background: rgba(218, 96, 87, 0.15); color: var(--brand-red); border: 1px solid var(--brand-red); }

        /* Chat Stream */
        #chat-container {
            flex: 1 1 0%;
            height: 0;
            min-height: 0;
            margin-top: -56px;
            padding: 68px 1rem 2rem 1rem;
            overflow-y: auto;
            overflow-x: hidden;
            -webkit-overflow-scrolling: touch;
            overscroll-behavior-y: contain;
            -webkit-overscroll-behavior-y: contain;
            user-select: text;
            -webkit-user-select: text;
            display: flex;
            flex-direction: column;
            position: relative;
        }

        .welcome-hero {
            margin: 3.5rem auto 2rem auto;
            text-align: center;
            max-width: 500px;
            width: 100%;
        }
        .welcome-hero h1 {
            font-family: var(--font-display);
            font-size: 1.5rem;
            font-weight: normal;
            background: linear-gradient(135deg, var(--text-main) 40%, var(--brand-primary) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }
        .welcome-hero p {
            color: var(--text-muted);
            font-size: 0.88rem;
            margin-bottom: 1.5rem;
        }
        .hero-suggestions-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
        }
        .hero-suggestion-card {
            background: var(--bg-surface);
            border: 1px solid var(--border-subtle);
            padding: 0.85rem;
            border-radius: 12px;
            cursor: pointer;
            text-align: left;
        }
        .hero-suggestion-card h4 { font-size: 0.85rem; color: var(--text-main); margin-bottom: 2px; }
        .hero-suggestion-card p { font-size: 0.78rem; color: var(--text-dim); margin-bottom: 0; }

        .message-block {
            margin-bottom: 1.25rem;
            display: flex;
            flex-direction: column;
            gap: 4px;
            width: 100%;
        }
        .message-block.user-block { align-items: flex-end; }
        .user-block .message-body {
            background: var(--user-bubble-bg);
            border: 1px solid var(--border-subtle);
            border-radius: 18px 18px 4px 18px;
            padding: 0.75rem 1.1rem;
            max-width: 88%;
            font-size: 0.92rem;
            line-height: 1.5;
        }

        .message-block.ai-block { align-items: flex-start; max-width: 100%; min-width: 0; }
        .ai-block .ai-bubble-card {
            width: 100%;
            max-width: 100%;
            min-width: 0;
            background: var(--bg-surface);
            border: 1.5px solid var(--agent-accent, var(--brand-teal));
            border-radius: 18px 18px 18px 4px;
            padding: 0.85rem 1.1rem;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
            overflow: hidden;
        }
        .ai-block .ai-bubble-card.tool-call-card {
            border: 2px dashed var(--agent-accent, var(--brand-teal));
            border-radius: 18px !important;
        }
        .ai-block .message-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.82rem;
            font-weight: 700;
            color: var(--agent-accent, var(--brand-teal));
            margin-bottom: 0.5rem;
            border-bottom: 1px dashed var(--border-subtle);
            padding-bottom: 4px;
        }
        .ai-block .message-body {
            width: 100%;
            max-width: 100%;
            min-width: 0;
            font-size: 0.92rem;
            line-height: 1.6;
            color: var(--text-main);
            word-break: break-word;
            overflow-wrap: break-word;
        }

        /* Markdown & Headings */
        .message-body h1, .message-body h2, .message-body h3 { margin-top: 1rem; margin-bottom: 0.4rem; color: var(--text-main); font-weight: 600; font-size: 1.05rem; }
        .message-body p { margin-bottom: 0.6rem; }
        .message-body ul, .message-body ol { margin: 0.4rem 0 0.6rem 1.25rem; }
        .message-body li { margin-bottom: 0.2rem; }
        
        .message-body code {
            font-family: var(--font-mono);
            background: rgba(125, 125, 125, 0.15);
            padding: 2px 5px;
            border-radius: 4px;
            font-size: 0.82rem;
        }

        .message-body > pre {
            white-space: pre-wrap;
            word-break: break-word;
            overflow-wrap: anywhere;
            font-family: var(--font-mono);
            font-size: 0.85rem;
            line-height: 1.5;
            margin: 0;
        }

        /* Code Block Wrapper with Top-Right Copy Button */
        .code-block-wrapper {
            position: relative;
            margin: 0.75rem 0;
            background: var(--code-block-bg);
            border: 1px solid var(--border-subtle);
            border-radius: 10px;
            overflow: hidden;
            max-width: 100%;
        }
        .code-header-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.35rem 0.75rem;
            background: var(--bg-card);
            border-bottom: 1px solid var(--border-subtle);
            font-size: 0.75rem;
            font-family: var(--font-mono);
            color: var(--text-dim);
        }
        .code-copy-btn {
            background: transparent;
            border: 1px solid var(--border-subtle);
            color: var(--text-muted);
            font-size: 0.72rem;
            font-family: var(--font-sans);
            padding: 2px 8px;
            border-radius: 6px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .code-copy-btn:hover, .code-copy-btn.copied {
            background: var(--bg-hover);
            color: var(--brand-primary);
            border-color: var(--brand-primary);
        }
        .code-copy-btn svg { width: 12px; height: 12px; fill: currentColor; }
        
        .code-block-wrapper pre {
            margin: 0;
            padding: 0.75rem 1rem;
            background: transparent;
            border: none;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            font-family: var(--font-mono);
            font-size: 0.8rem;
            scrollbar-width: thin;
        }
        .code-block-wrapper pre code {
            background: transparent;
            padding: 0;
        }

        /* Responsive Table Scroll Container */
        .table-container {
            width: 100%;
            max-width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            margin: 0.8rem 0;
            border-radius: 8px;
            border: 1px solid var(--border-subtle);
            scrollbar-width: thin;
            background: var(--bg-surface);
        }
        .message-body table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            margin: 0;
        }
        .message-body th, .message-body td {
            padding: 7px 12px;
            border: 1px solid var(--border-subtle);
            text-align: left;
            white-space: nowrap;
        }
        .message-body th { background: var(--bg-card); font-weight: 600; color: var(--text-main); }

        /* KaTeX Block Math & Matrix Scrolling */
        .katex-display {
            width: 100%;
            max-width: 100% !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            padding: 0.6rem 0.25rem !important;
            margin: 0.6rem 0 !important;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: thin;
        }
        .katex {
            font-size: 1.05em;
            max-width: 100%;
        }

        .tool-result-box {
            width: 100%;
            max-width: 100%;
            min-width: 0;
            background: var(--bg-surface);
            border: 2px dotted var(--agent-accent, var(--brand-teal));
            border-radius: 18px;
            padding: 0.85rem 1.1rem;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
            overflow: hidden;
            cursor: pointer;
        }
        .tool-result-box .message-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.82rem;
            font-weight: 700;
            color: var(--agent-accent, var(--brand-teal));
            margin-bottom: 0.5rem;
            border-bottom: 1px dashed var(--border-subtle);
            padding-bottom: 4px;
        }
        .tool-result-box .message-body {
            width: 100%;
            font-size: 0.92rem;
            line-height: 1.6;
            color: var(--text-muted);
            word-break: break-word;
            overflow-wrap: break-word;
            white-space: pre-wrap;
            font-family: var(--font-mono);
        }

        /* Working / Gyro Reactor */
        #working-indicator {
            display: none;
            align-items: center;
            gap: 10px;
            padding-bottom: 6px;
            position: relative;
            z-index: 10;
        }
        #reactor-canvas { width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; }
        #working-text { font-size: 0.82rem; color: var(--text-muted); font-weight: 500; }

        /* Floating Input Dock */
        #input-dock {
            flex-shrink: 0;
            padding: 0.5rem 1rem calc(1.5rem + env(safe-area-inset-bottom, 16px)) 1rem;
            position: relative;
            z-index: 100;
        }
        #input-dock::before {
            content: '';
            position: absolute;
            top: -28px;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(to top, var(--bg-base) 65%, transparent);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            mask-image: linear-gradient(to top, black 70%, transparent);
            -webkit-mask-image: linear-gradient(to top, black 70%, transparent);
            z-index: -1;
            pointer-events: none;
        }

        /* Staged Attachment Chips */
        #pending-attachments-bar {
            display: none;
            flex-wrap: wrap;
            gap: 6px;
            padding-bottom: 6px;
        }
        .attachment-chip {
            background: var(--bg-surface);
            border: 1px solid var(--brand-teal);
            color: var(--text-main);
            padding: 3px 8px 3px 10px;
            border-radius: 14px;
            font-size: 0.78rem;
            font-family: var(--font-mono);
            display: flex;
            align-items: center;
            gap: 6px;
            max-width: 220px;
        }
        .attachment-chip span {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .attachment-chip button {
            background: none;
            border: none;
            color: var(--brand-red);
            cursor: pointer;
            font-size: 0.95rem;
            line-height: 1;
            padding: 0 2px;
        }

        .input-capsule {
            background: var(--bg-surface);
            border: 1.5px solid var(--border-subtle);
            border-radius: 24px;
            padding: 0.35rem 0.55rem;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }

        .attach-btn {
            position: relative;
            background: var(--bg-card);
            color: var(--text-main);
            border: 1px solid var(--border-subtle);
            width: 34px;
            height: 34px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;
            font-size: 1.3rem;
            font-family: var(--font-sans);
            line-height: 1;
            transition: all 0.2s ease;
            user-select: none;
            -webkit-user-select: none;
            overflow: hidden;
        }
        .attach-btn:hover, .attach-btn:active {
            background: var(--bg-hover);
            border-color: var(--brand-primary);
            color: var(--brand-primary);
        }
        .hidden-file-input {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            opacity: 0.001;
            cursor: pointer;
            z-index: 10;
        }
        .input-capsule:focus-within {
            border-color: var(--brand-primary);
            box-shadow: 0 4px 20px rgba(61, 219, 217, 0.25);
        }

        #chat-input {
            flex: 1;
            background: transparent;
            border: none;
            color: var(--text-main);
            font-size: 0.92rem;
            font-family: var(--font-sans);
            outline: none;
            user-select: text;
            -webkit-user-select: text;
            resize: none;
            min-height: 22px;
            max-height: 100px;
            line-height: 22px;
            padding: 5px 0;
            margin: 0;
            display: block;
        }

        .send-btn {
            background: var(--brand-primary);
            color: #000;
            border: none;
            width: 34px;
            height: 34px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;
        }
        .send-btn svg { width: 15px; height: 15px; fill: currentColor; }

        /* Suggestions Popup */
        #suggestions-popup {
            display: none;
            position: absolute;
            bottom: calc(100% + 4px);
            left: 1rem;
            right: 1rem;
            background: var(--bg-surface);
            border: 1px solid var(--border-focus);
            border-radius: 12px;
            max-height: 180px;
            overflow-y: auto;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6);
            z-index: 100;
        }
        .suggestion-item {
            padding: 8px 12px;
            font-size: 0.82rem;
            display: flex;
            justify-content: space-between;
            cursor: pointer;
            border-bottom: 1px solid rgba(125, 125, 125, 0.08);
        }
        .suggestion-item.selected, .suggestion-item:hover {
            background: var(--bg-card);
            color: var(--brand-primary);
        }

        /* --- COMPREHENSIVE MODALS --- */
        .modal-overlay {
            display: none;
            position: fixed; inset: 0;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(6px);
            justify-content: center;
            align-items: center;
            z-index: 2000;
            padding: 1rem;
        }
        .modal-dialog {
            background: var(--bg-surface);
            border: 1px solid var(--border-subtle);
            border-radius: 16px;
            padding: 1.25rem;
            width: 100%;
            max-width: 520px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.8);
        }
        .modal-dialog h2 {
            font-family: var(--font-display);
            font-size: 1.05rem;
            font-weight: normal;
            margin-bottom: 0.6rem;
            color: var(--text-main);
            border-bottom: 1px solid var(--border-subtle);
            padding-bottom: 0.4rem;
        }
        .modal-body { flex: 1; overflow-y: auto; padding-right: 4px; }
        .section-header {
            font-size: 0.72rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--brand-orange);
            margin: 1rem 0 0.4rem 0;
            border-bottom: 1px dashed var(--border-subtle);
            padding-bottom: 2px;
        }
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 0.65rem;
            align-items: flex-start;
        }
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 0.65rem;
            min-width: 0;
        }
        .form-group label {
            font-size: 0.74rem;
            font-weight: 600;
            color: var(--text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .form-control {
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            padding: 7px 10px;
            color: var(--text-main);
            font-size: 0.84rem;
            outline: none;
            width: 100%;
            height: 36px;
            box-sizing: border-box;
        }
        .form-control:focus { border-color: var(--brand-primary); }
        select.form-control { height: 36px; }
        textarea.form-control {
            height: auto;
            min-height: 56px;
            resize: vertical;
            font-family: var(--font-sans);
        }
        
        .checkbox-group { display: flex; align-items: center; gap: 8px; margin: 0.4rem 0; }
        .checkbox-group label { font-size: 0.78rem; color: var(--text-main); cursor: pointer; }

        .color-picker-wrapper {
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
        }
        .color-swatch-input {
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
            width: 36px;
            height: 36px;
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            background: transparent;
            cursor: pointer;
            padding: 0;
            flex-shrink: 0;
            overflow: hidden;
        }
        .color-swatch-input::-webkit-color-swatch-wrapper {
            padding: 0;
        }
        .color-swatch-input::-webkit-color-swatch {
            border: none;
            border-radius: 7px;
        }

        .abilities-table { width: 100%; border-collapse: collapse; margin-top: 0.4rem; font-size: 0.78rem; }
        .abilities-table th, .abilities-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border-subtle); }
        .abilities-table th { color: var(--text-muted); font-weight: 600; }

        .modal-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 0.8rem;
            padding-top: 0.8rem;
            border-top: 1px solid var(--border-subtle);
        }
        .modal-btn {
            font-size: 0.82rem;
            font-weight: 700;
            padding: 7px 15px;
            border-radius: 20px;
            border: none;
            cursor: pointer;
        }
        .btn-primary { background: var(--brand-primary); color: #000; }
        .btn-secondary { background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-subtle); }
        .btn-danger { background: var(--brand-red); color: #fff; }

        /* --- DEEP RESEARCH SWARM HUD --- */
        #research-swarm-hud {
            display: none;
            flex-direction: column;
            width: 100%;
            flex-shrink: 0;
            min-height: min-content;
            background: var(--bg-surface);
            border: 1.5px solid var(--brand-teal);
            border-radius: 16px;
            margin: 1rem 0;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(61, 219, 217, 0.2);
            animation: hud-pulse 3s infinite alternate ease-in-out;
        }

        @keyframes hud-pulse {
            0% { border-color: var(--brand-teal); box-shadow: 0 0 16px rgba(61, 219, 217, 0.15); }
            100% { border-color: var(--brand-yellow); box-shadow: 0 0 24px rgba(242, 168, 19, 0.25); }
        }

        .swarm-header {
            display: flex;
            align-items: center;
            padding: 10px 14px;
            background: var(--bg-card);
            border-bottom: 1px solid var(--border-subtle);
            flex-shrink: 0;
        }
        .swarm-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-family: var(--font-display);
            font-size: 0.8rem;
            color: var(--brand-teal);
            font-weight: 700;
            letter-spacing: 0.05em;
        }

        .swarm-body {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 12px;
            width: 100%;
            flex-shrink: 0;
        }

        .swarm-tasks-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 100%;
            flex-shrink: 0;
        }

        .swarm-task-card {
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: 10px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 100%;
            flex-shrink: 0;
            transition: all 0.3s ease;
        }
        .swarm-task-card.active {
            border-color: rgba(61, 219, 217, 0.4);
        }
        .swarm-task-card.completed {
            border-color: rgba(140, 200, 75, 0.6);
            background: rgba(140, 200, 75, 0.05);
        }

        .swarm-task-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 10px;
            font-size: 0.78rem;
            font-weight: 600;
            width: 100%;
        }
        .swarm-task-left {
            display: flex;
            align-items: flex-start;
            gap: 9px;
            min-width: 0;
            flex: 1;
        }
        
        @keyframes swarm-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .swarm-spinner {
            width: 13px;
            height: 13px;
            border: 2px solid rgba(242, 168, 19, 0.25);
            border-top-color: var(--brand-yellow);
            border-radius: 50%;
            animation: swarm-spin 0.75s linear infinite;
            flex-shrink: 0;
            margin-top: 2px;
        }
        .swarm-spinner.done {
            border: none;
            animation: none;
            width: 14px;
            height: 14px;
            color: var(--brand-green);
            font-size: 0.9rem;
            font-weight: bold;
            line-height: 1;
            margin-top: 1px;
        }

        .swarm-task-name {
            color: var(--text-main);
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
            line-height: 1.4;
            flex: 1;
        }
        .swarm-task-pct {
            font-family: var(--font-mono);
            font-size: 0.75rem;
            color: var(--brand-yellow);
            font-weight: 700;
            flex-shrink: 0;
            align-self: flex-start;
            margin-top: 1px;
        }

        .swarm-progress-track {
            width: 100%;
            height: 6px;
            background: var(--code-block-bg);
            border-radius: 3px;
            overflow: hidden;
            flex-shrink: 0;
        }
        .swarm-progress-fill {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, var(--brand-teal), var(--brand-green));
            border-radius: 3px;
            transition: width 0.35s ease;
        }

        .swarm-log-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-family: var(--font-mono);
            font-size: 0.72rem;
            color: var(--brand-orange);
            font-weight: 700;
            margin-top: 2px;
            padding: 0 2px;
            flex-shrink: 0;
        }

        .swarm-log-container {
            background: var(--code-block-bg);
            border: 1px solid var(--border-subtle);
            border-radius: 10px;
            height: 180px;
            min-height: 180px;
            overflow-y: auto;
            padding: 8px 10px;
            font-family: var(--font-mono);
            font-size: 0.72rem;
            color: var(--text-muted);
            line-height: 1.45;
            scrollbar-width: thin;
            flex-shrink: 0;
        }
        .swarm-log-line {
            margin-bottom: 4px;
            word-break: break-word;
            overflow-wrap: anywhere;
        }

        /* Clear Cache Broom & Glow Animations */
        @keyframes broom-sweep {
            0% { transform: rotate(0deg) scale(1); }
            25% { transform: rotate(-25deg) scale(1.15); }
            50% { transform: rotate(15deg) scale(1.15); }
            75% { transform: rotate(-20deg) scale(1.15); }
            100% { transform: rotate(0deg) scale(1); }
        }

        @keyframes cache-pulse {
            0% { box-shadow: 0 0 0 0 rgba(242, 168, 19, 0.4); border-color: var(--brand-yellow); }
            50% { box-shadow: 0 0 12px 3px rgba(242, 168, 19, 0.6); border-color: var(--brand-teal); }
            100% { box-shadow: 0 0 0 0 rgba(242, 168, 19, 0.4); border-color: var(--brand-yellow); }
        }

        @keyframes success-pop {
            0% { transform: scale(0.9); opacity: 0; }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); opacity: 1; }
        }

        .btn-clearing {
            animation: cache-pulse 1.2s infinite ease-in-out;
            pointer-events: none;
            opacity: 0.85;
        }

        .btn-clearing .sweep-icon {
            display: inline-block;
            animation: broom-sweep 0.6s infinite ease-in-out;
        }

        .btn-cleared {
            animation: success-pop 0.3s ease-out;
            border-color: var(--brand-green) !important;
            color: var(--brand-green) !important;
        }
    </style>
</head>
<body>

    <!-- SIDEBAR DRAWER OVERLAY -->
    <div id="sidebar-overlay"></div>

    <!-- SIDEBAR DRAWER -->
    <aside id="sidebar">
        <div class="sidebar-header">
            <div class="sidebar-brand">FEDERaiDE</div>
            <button class="icon-btn" id="btn-close-drawer" aria-label="Close menu">
                <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
        </div>

        <button class="btn-new-chat-tray" id="btn-tray-new-chat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            <span>New conversation</span>
        </button>

        <div class="sidebar-scroll">
            <div class="sidebar-section-title">Recent Conversations</div>
            <div id="drawer-recents-list" class="recents-list"></div>
            <button id="btn-toggle-all-sessions" class="btn-toggle-all-chats" style="display: none;">... View all conversations</button>
        </div>

        <div class="sidebar-footer">
            <button class="tray-action-btn" id="btn-tray-termux">
                <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.58-2.59L7.5 9l4 4-4 4z"/></svg>
                <span>Termux Console</span>
            </button>
            <button class="tray-action-btn" id="btn-tray-settings">
                <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                <span>Global Settings</span>
            </button>
            <button class="tray-action-btn" id="btn-tray-agent-edit">
                <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                <span>Manage Active Agent</span>
            </button>
            <button class="tray-action-btn" id="btn-tray-schedules">
                <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                <span>Task Schedules</span>
            </button>
            <button class="tray-action-btn" id="btn-tray-directory">
                <svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                <span id="tray-cwd-label">Workspace Directory</span>
            </button>
        </div>
    </aside>
    
    <!-- WORKSPACE EXPLORER MODAL -->
    <div id="workspace-modal" class="modal-overlay">
        <div class="modal-dialog" style="max-width: 480px; max-height: 80vh;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.6rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.4rem;">
                <h2 style="margin: 0; border: none; padding: 0;">Workspace Files</h2>
                <button class="modal-btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" id="btn-ws-up">⬆ Up</button>
            </div>
            <div id="ws-breadcrumb" style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--brand-teal); margin-bottom: 0.5rem; word-break: break-all;">/</div>
            <div class="modal-body" style="min-height: 200px;">
                <div id="ws-file-list" style="display:flex; flex-direction:column; gap: 4px;"></div>
            </div>
            <div class="modal-actions" style="justify-content: space-between;">
                <button class="modal-btn btn-secondary" id="btn-ws-clear-cache" style="color: var(--brand-yellow); transition: all 0.25s ease;">
                    <span class="sweep-icon">🧹</span> <span class="btn-text">Clear Cache</span>
                </button>
                <button class="modal-btn btn-secondary" onclick="closeModals()">Close</button>
            </div>
        </div>
    </div>

    <!-- DELETE CONFIRMATION MODAL -->
    <div id="delete-confirm-modal" class="modal-overlay">
        <div class="modal-dialog" style="max-width: 380px;">
            <h2 style="color: var(--brand-red);">Confirm Deletion</h2>
            <div class="modal-body">
                <p style="font-size: 0.85rem; color: var(--text-main); margin-bottom: 8px;">Are you sure you want to permanently delete:</p>
                <p id="del-item-name" style="font-family: var(--font-mono); font-size: 0.82rem; color: var(--brand-yellow); background: var(--bg-card); padding: 8px; border-radius: 6px; word-break: break-all;"></p>
                <p style="font-size: 0.78rem; color: var(--text-dim); margin-top: 8px;">This action cannot be undone.</p>
            </div>
            <div class="modal-actions">
                <button class="modal-btn btn-danger" id="btn-confirm-delete">Delete</button>
                <button class="modal-btn btn-secondary" onclick="document.getElementById('delete-confirm-modal').style.display='none'">Cancel</button>
            </div>
        </div>
    </div>
    
    <!-- MAIN INTERFACE -->
    <main id="app-main">
        <header>
            <div class="header-left">
                <button class="icon-btn" id="btn-open-drawer" title="Menu">
                    <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
                </button>
                
                <div class="model-selector-pill" id="btn-header-agent-pill">
                    <span class="agent-dot" id="header-agent-dot"></span>
                    <span id="header-agent-name">Rita</span>
                    <span style="font-size: 0.7rem; color: var(--text-dim);">▾</span>
                </div>
            </div>

            <div class="header-center">
                <button class="icon-btn" id="btn-theme-toggle" title="Toggle Light / Dark Mode">
                    <svg id="theme-moon-icon" viewBox="0 0 24 24" style="display: none;"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>
                    <svg id="theme-sun-icon" viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
                </button>
            </div>

            <div class="header-right">
                <span id="status-mode" class="badge-pill mode-plan" title="Click to cycle security permissions">[SAFE]</span>
                <button class="icon-btn" id="btn-abort" title="Abort">
                    <svg viewBox="0 0 100 100" style="width: 28px; height: 28px;">
                        <circle cx="50" cy="50" r="48" fill="var(--brand-red, #da6057)"/>
                        <defs>
                            <path id="abort-arrow-seg" d="M 77.2 27.2 A 35.5 35.5 0 0 1 77.2 72.8 L 83.6 74.4 L 66.7 76.7 L 65.2 65.2 L 71.1 67.7 A 27.5 27.5 0 0 0 71.1 32.3 Z" fill="#ffffff"/>
                        </defs>
                        <use href="#abort-arrow-seg"/>
                        <use href="#abort-arrow-seg" transform="rotate(120 50 50)"/>
                        <use href="#abort-arrow-seg" transform="rotate(240 50 50)"/>
                    </svg>
                </button>
            </div>
        </header>

        <div id="header-agent-dropdown">
            <input type="text" id="header-agent-search" class="dropdown-search-input" placeholder="Search agents...">
            <div id="dropdown-agents-list" class="dropdown-agents-list"></div>
        </div>

        <!-- STREAMING CHAT AREA -->
        <div id="chat-container">
            <div class="welcome-hero" id="welcome-hero">
                <h1>What will your agents explore today?</h1>
                <p>Collaborative multi-agent intelligence and autonomous task execution.</p>
                <div class="hero-suggestions-grid">
                    <div class="hero-suggestion-card" onclick="setPromptText('Research the latest advancements in quantum computing')">
                        <h4>Deep Research</h4>
                        <p>Deploy a parallel swarm to synthesize findings into PDF.</p>
                    </div>
                    <div class="hero-suggestion-card" onclick="setPromptText('&src/ review this codebase and suggest optimizations')">
                        <h4>Code Review</h4>
                        <p>Inject workspace files directly into the prompt bar.</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- FLOATING INPUT DOCK -->
        <div id="input-dock">
            <div id="working-indicator">
                <canvas id="reactor-canvas" width="36" height="36"></canvas>
                <span id="working-text"></span>
            </div>

            <div id="suggestions-popup"></div>
            <div id="pending-attachments-bar"></div>

            <div class="input-capsule" id="input-capsule-dropzone">
                <label class="attach-btn" title="Attach file">
                    +
                    <input type="file" id="file-picker-input" class="hidden-file-input" multiple>
                </label>
                <textarea id="chat-input" rows="1" placeholder='Ask "what can you do?"' autofocus></textarea>
                <button class="send-btn" id="btn-send" title="Send (Enter)">
                    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
            </div>
        </div>
    </main>

    

    <!-- ONBOARDING MODAL [First-Time Launch] -->
    <div id="onboarding-modal" class="modal-overlay">
        <div class="modal-dialog" style="max-width: 490px; border: 1.5px solid var(--brand-green); box-shadow: 0 10px 40px rgba(140, 200, 75, 0.25);">
            <h2 style="color: var(--brand-green); text-align: center; border: none; padding-bottom: 2px; margin-bottom: 2px;">Welcome to FEDERaiDE</h2>
            <p style="color: var(--text-muted); font-size: 0.78rem; text-align: center; margin-bottom: 12px;">Configure your primary agent to initialize the multi-agent harness.</p>
            
            <div class="modal-body">
                <div class="form-row">
                    <div class="form-group">
                        <label>Base URL Preset</label>
                        <select id="onboard-base-preset" class="form-control">
                            <option value="https://generativelanguage.googleapis.com/v1beta/openai/">Google Gemini</option>
                            <option value="https://openrouter.ai/api/v1">OpenRouter</option>
                            <option value="https://api.openai.com/v1/">OpenAI</option>
                            <option value="https://api.anthropic.com/v1/">Anthropic</option>
                            <option value="https://chatgpt.com/backend-api/codex">ChatGPT (OAuth)</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Model Identifier</label>
                        <input type="text" id="onboard-model" class="form-control" value="gemini-3.5-flash-lite">
                    </div>
                </div>

                <div class="form-group">
                    <label>Base URL Endpoint</label>
                    <input type="text" id="onboard-base-url" class="form-control" value="https://generativelanguage.googleapis.com/v1beta/openai/">
                </div>

                <div class="form-group">
                    <label id="onboard-api-key-label">API Key</label>
                    <input type="password" id="onboard-api-key" class="form-control" placeholder="Enter API Key...">
                    <button type="button" class="modal-btn btn-primary" id="btn-onboard-chatgpt-auth" style="display: none; height: 36px; width: 100%; font-size: 0.8rem; background: var(--brand-green); color: #000;">Authenticate with ChatGPT (OAuth)</button>
                    <div id="onboard-chatgpt-status" style="font-size: 0.75rem; margin-top: 3px; font-weight: 600; text-align: center; min-height: 14px;"></div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Agent Name</label>
                        <input type="text" id="onboard-name" class="form-control" value="Rita">
                    </div>
                    <div class="form-group">
                        <label>Color</label>
                        <div class="color-picker-wrapper">
                            <input type="color" id="onboard-color-picker" class="color-swatch-input" value="#3ddbd9">
                            <input type="text" id="onboard-color" class="form-control" value="#3ddbd9">
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <label>Agent Backstory</label>
                    <textarea id="onboard-backstory" class="form-control" style="min-height: 60px;">You are Rita, a general purpose senior developer.</textarea>
                </div>

                <div id="onboard-status-msg" style="font-size: 0.78rem; text-align: center; margin-top: 4px; min-height: 18px; font-weight: 600;"></div>
            </div>

            <div class="modal-actions" style="border: none; padding-top: 4px;">
                <button class="modal-btn btn-primary" id="btn-onboard-submit" style="background: var(--brand-green); color: #000; width: 100%; padding: 10px; font-size: 0.88rem;">🚀 Initialize Agent & Start</button>
            </div>
        </div>
    </div>

    <!-- KEYRING UNLOCK MODAL -->
    <div id="keyring-modal" class="modal-overlay">
        <div class="modal-dialog" style="max-width: 420px;">
            <h2 style="color: var(--brand-orange);">Keyring Locked</h2>
            <div class="modal-body">
                <button class="modal-btn btn-primary" id="btn-keyring-bio" style="background: var(--brand-teal); color: #000; width: 100%; padding: 11px; margin-bottom: 12px; font-weight: 700; font-size: 0.88rem; display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: 12px;">
                    <span style="font-size: 1.1rem;">👆</span> <span>Unlock with Fingerprint / Face ID</span>
                </button>
                <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 6px;">Or enter your Master Password manually:</p>
                <input type="password" id="keyring-password-input" class="form-control" placeholder="Master Password">
                <p style="color: var(--brand-red); font-size: 0.72rem; margin-top: 6px; line-height: 1.4;">Resetting or setting a new password will permanently delete any previously saved keys in this keyring.</p>
                <p id="keyring-error-msg" style="color: var(--brand-yellow); font-size: 0.78rem; margin-top: 6px; min-height: 18px; text-align: center; cursor: pointer; text-decoration: underline;" onclick="document.getElementById('btn-keyring-bio')?.click()"></p>
            </div>
            <div class="modal-actions" style="gap: 6px; flex-wrap: wrap;">
                <button class="modal-btn btn-primary" id="btn-keyring-unlock">Unlock</button>
                <button class="modal-btn btn-secondary" id="btn-keyring-reset" style="color: var(--brand-yellow);">Set New / Reset</button>
                <button class="modal-btn btn-secondary" onclick="document.getElementById('keyring-modal').style.display='none'">Cancel</button>
            </div>
        </div>
    </div>

    <!-- TOOL CONFIRMATION MODAL -->
    <div id="tool-modal" class="modal-overlay">
        <div class="modal-dialog" style="max-width: 480px;">
            <h2 id="modal-tool-title" style="color: var(--brand-yellow);">Tool Authorization Required</h2>
            <div class="modal-body">
                <p id="modal-tool-desc" style="font-size: 0.85rem; color: var(--text-muted);">The agent has requested execution of the following action:</p>
                <pre id="modal-tool-args" style="background: var(--code-block-bg); padding: 10px; border-radius: 8px; margin: 10px 0; font-size: 0.8rem; overflow-x: auto;"></pre>
                
                <div id="clarify-options-container" style="display: none; flex-direction: column; gap: 6px; margin: 10px 0;"></div>
                
                <div id="clarify-input-box" style="display: none; margin-top: 10px;">
                    <label style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted);">Or type a custom response:</label>
                    <input type="text" id="clarify-user-input" class="form-control" placeholder="Type clarification response...">
                </div>
            </div>
            <div class="modal-actions" style="justify-content: flex-end; gap: 6px; flex-wrap: wrap;">
                <button class="modal-btn btn-primary" id="btn-approve">Approve</button>
                <button class="modal-btn btn-secondary" id="btn-reject" style="color: var(--brand-yellow);">Reject</button>
                <button class="modal-btn btn-danger" id="btn-modal-abort">Abort (Stop)</button>
            </div>
        </div>
    </div>

    <!-- AGENT CONFIGURATION MODAL [F4] -->
    <div id="agent-config-modal" class="modal-overlay">
        <div class="modal-dialog">
            <h2>Agent Configuration</h2>
            <div class="modal-body">
                <div class="section-header">Primary Settings</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Agent Name</label>
                        <input type="text" id="cfg-agent-name" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Agent Color</label>
                        <div class="color-picker-wrapper">
                            <input type="color" id="cfg-agent-color-picker" class="color-swatch-input" value="#3ddbd9">
                            <input type="text" id="cfg-agent-color" class="form-control" placeholder="#3ddbd9">
                        </div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Model Identifier</label>
                        <input type="text" id="cfg-agent-model" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Reasoning Effort</label>
                        <select id="cfg-agent-reasoning" class="form-control">
                            <option value="none">Default (None)</option>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Temperature</label>
                        <input type="number" id="cfg-agent-temp" class="form-control" step="0.1" min="0" max="2">
                    </div>
                    <div class="form-group">
                        <label>Base URL Preset</label>
                        <select id="cfg-agent-base-preset" class="form-control">
                            <option value="https://generativelanguage.googleapis.com/v1beta/openai/">Google Gemini</option>
                            <option value="https://openrouter.ai/api/v1">OpenRouter</option>
                            <option value="https://api.openai.com/v1/">OpenAI</option>
                            <option value="https://api.anthropic.com/v1/">Anthropic</option>
                            <option value="https://chatgpt.com/backend-api/codex">ChatGPT Subscription (OAuth)</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Base URL Endpoint</label>
                        <input type="text" id="cfg-agent-base-url" class="form-control">
                    </div>
                    <div class="form-group">
                        <label id="cfg-agent-api-key-label">API Key</label>
                        <input type="password" id="cfg-agent-api-key" class="form-control">
                        <button type="button" class="modal-btn btn-primary" id="btn-chatgpt-auth" style="display: none; height: 36px; width: 100%; font-size: 0.75rem; padding: 4px 8px;">Authenticate (OAuth)</button>
                        <div id="chatgpt-auth-status" style="font-size: 0.75rem; margin-top: 2px; font-weight: 600; text-align: center; min-height: 14px;"></div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>TTS Voice</label>
                        <select id="cfg-agent-voice" class="form-control">
                            <option value="af_sarah">af_sarah (US Female)</option>
                            <option value="af_bella">af_bella (US Female)</option>
                            <option value="af_heart">af_heart (US Female)</option>
                            <option value="am_adam">am_adam (US Male)</option>
                            <option value="am_echo">am_echo (US Male)</option>
                            <option value="bf_alice">bf_alice (UK Female)</option>
                            <option value="bm_george">bm_george (UK Male)</option>
                            <option value="jf_alpha">jf_alpha (JP Female)</option>
                            <option value="zf_xiaobei">zf_xiaobei (ZH Female)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Pronouns</label>
                        <select id="cfg-agent-pronouns" class="form-control">
                            <option value="she/her">She/Her</option>
                            <option value="he/him">He/Him</option>
                            <option value="neither">Neither</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Backstory</label>
                    <textarea id="cfg-agent-backstory" class="form-control"></textarea>
                </div>
                <div class="form-row">
                    <div class="checkbox-group">
                        <input type="checkbox" id="cfg-agent-vision">
                        <label for="cfg-agent-vision">Vision Capable</label>
                    </div>
                    <div class="checkbox-group">
                        <input type="checkbox" id="cfg-agent-disable-all">
                        <label for="cfg-agent-disable-all">Disable All Tools</label>
                    </div>
                </div>

                <!-- Backup Failover -->
                <div class="section-header">Backup Provider (Failover)</div>
                <div class="checkbox-group">
                    <input type="checkbox" id="cfg-agent-use-backup">
                    <label for="cfg-agent-use-backup">Enable Automatic Backup Failover</label>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Copy Credentials From Agent</label>
                        <select id="cfg-copy-from-agent" class="form-control">
                            <option value="">Manual Entry</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Backup API Key</label>
                        <input type="password" id="cfg-agent-backup-key" class="form-control">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Backup Model</label>
                        <input type="text" id="cfg-agent-backup-model" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Backup Base URL</label>
                        <input type="text" id="cfg-agent-backup-base" class="form-control">
                    </div>
                </div>

                <!-- Tool Abilities Table -->
                <div class="section-header">Agent Tool Permissions</div>
                <table class="abilities-table">
                    <thead>
                        <tr>
                            <th>Tool Name</th>
                            <th>Enable (Safe)</th>
                            <th>Disable</th>
                        </tr>
                    </thead>
                    <tbody id="abilities-table-body"></tbody>
                </table>
            </div>
            <div id="cfg-agent-status-msg" style="font-size: 0.78rem; text-align: center; margin-top: 6px; min-height: 18px; font-weight: 600;"></div>
            <div class="modal-actions">
                <button class="modal-btn btn-danger" id="btn-delete-agent">Delete</button>
                <button class="modal-btn btn-secondary" id="btn-save-as-new">Save As New</button>
                <button class="modal-btn btn-primary" id="btn-save-agent">Save Changes</button>
                <button class="modal-btn btn-secondary" onclick="closeModals()">Cancel</button>
            </div>
        </div>
    </div>

    <!-- GLOBAL HARNESS SETTINGS MODAL [F3] -->
    <div id="global-settings-modal" class="modal-overlay">
        <div class="modal-dialog">
            <h2>Global Harness Settings</h2>
            <div class="modal-body">
                <div class="section-header">User Identity</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>User Display Name</label>
                        <input type="text" id="cfg-user-name" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>User Label Color</label>
                        <div class="color-picker-wrapper">
                            <input type="color" id="cfg-user-color-picker" class="color-swatch-input" value="#dda0dd">
                            <input type="text" id="cfg-user-color" class="form-control" placeholder="#dda0dd">
                        </div>
                    </div>
                </div>

                <div class="section-header">Search & Scraping Parameters</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Search Pacing Delay (Sec)</label>
                        <input type="number" id="cfg-search-delay" class="form-control" step="0.5">
                    </div>
                    <div class="form-group">
                        <label>Max Search Results</label>
                        <input type="number" id="cfg-max-search-results" class="form-control">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Scraper Max Bytes</label>
                        <input type="number" id="cfg-scraper-max-bytes" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Scraper Timeout (Sec)</label>
                        <input type="number" id="cfg-scraper-timeout" class="form-control">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Scraper Max Token Limit</label>
                        <input type="number" id="cfg-scraper-max-tokens" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Quota Block Wait (Sec)</label>
                        <input type="number" id="cfg-quota-retry-delay" class="form-control">
                    </div>
                </div>

                <div class="section-header">API Connection & Recovery</div>
                <div class="checkbox-group">
                    <input type="checkbox" id="cfg-autoupdate-on-launch">
                    <label for="cfg-autoupdate-on-launch">Check for updates automatically on launch</label>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Max Connection Retries</label>
                        <input type="number" id="cfg-max-api-retries" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Retry Delay (Sec)</label>
                        <input type="number" id="cfg-api-retry-delay" class="form-control">
                    </div>
                </div>

                <div class="section-header">Deep Research Swarm</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Max Parallel Sub-agents</label>
                        <input type="number" id="cfg-max-research-agents" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Context Token Limit</label>
                        <input type="number" id="cfg-research-context-tokens" class="form-control">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Report Min Token Length</label>
                        <input type="number" id="cfg-research-min-length" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Max Shrink Attempts</label>
                        <input type="number" id="cfg-max-shrink-attempts" class="form-control">
                    </div>
                </div>

                <div class="section-header">PDF Report Styling</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Rendering DPI</label>
                        <input type="number" id="cfg-pdf-dpi" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Footer Text</label>
                        <input type="text" id="cfg-pdf-footer-text" class="form-control">
                    </div>
                </div>

                <div class="section-header">Deep Research Image Companion</div>
                <div class="checkbox-group">
                    <input type="checkbox" id="cfg-research-image-enabled">
                    <label for="cfg-research-image-enabled">Enable Deep Research Image Companion</label>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Max Images</label>
                        <input type="number" id="cfg-research-images-max" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Image Retries</label>
                        <input type="number" id="cfg-research-image-retries" class="form-control">
                    </div>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="cfg-research-images-links">
                    <label for="cfg-research-images-links">Embed Images Directly</label>
                </div>

                <div class="section-header">Intercom & Memory</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Tool Visibility</label>
                        <select id="cfg-tool-vis" class="form-control">
                            <option value="private">Private (Hidden behind stubs)</option>
                            <option value="public">Public (Broadcast immediately)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Verbatim Messages to Keep</label>
                        <input type="number" id="cfg-keep-verbatim-count" class="form-control" min="1">
                    </div>
                </div>
            </div>
            <div class="modal-actions">
                <button class="modal-btn btn-primary" id="btn-save-global">Save All</button>
                <button class="modal-btn btn-secondary" onclick="closeModals()">Cancel</button>
            </div>
        </div>
    </div>

    <!-- SCHEDULES MODAL [/schedule] -->
    <div id="schedule-modal" class="modal-overlay">
        <div class="modal-dialog">
            <h2>Automated Task Schedules</h2>
            <div class="modal-body">
                <div class="section-header">Create New Schedule</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Agent</label>
                        <select id="sched-agent-select" class="form-control"></select>
                    </div>
                    <div class="form-group">
                        <label>Time (24h HH:MM)</label>
                        <input type="text" id="sched-time-input" class="form-control" placeholder="14:30">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Date (Optional YYYY-MM-DD)</label>
                        <input type="text" id="sched-date-input" class="form-control" placeholder="2026-08-15">
                    </div>
                    <div class="form-group">
                        <label>Repeat Cycle</label>
                        <select id="sched-repeat-select" class="form-control">
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="annually">Annually</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Task Prompt</label>
                    <textarea id="sched-prompt-input" class="form-control" placeholder="e.g. Research the morning tech news and compile a report..."></textarea>
                </div>
                <button class="modal-btn btn-primary" id="btn-create-schedule" style="width: 100%; margin-top: 4px;">+ Add Task Routine</button>

                <div class="section-header" style="margin-top: 1.2rem;">Active Scheduled Routines</div>
                <div id="sched-list" style="display: flex; flex-direction: column; gap: 6px; min-height: 40px;"></div>
            </div>
            <div class="modal-actions">
                <button class="modal-btn btn-secondary" onclick="closeModals()">Close</button>
            </div>
        </div>
    </div>

    <!-- FIND & REPLACE MODAL [Ctrl+F Parity] -->
    <div id="find-replace-modal" class="modal-overlay">
        <div class="modal-dialog" style="max-width: 460px;">
            <h2 style="color: var(--brand-primary);">Find & Replace</h2>
            <div class="modal-body">
                <div class="form-group">
                    <label>Find:</label>
                    <input type="text" id="fr-find-input" class="form-control" placeholder="Search text...">
                </div>
                <div class="form-group">
                    <label>Replace:</label>
                    <input type="text" id="fr-replace-input" class="form-control" placeholder="Replace with...">
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="fr-case-cb">
                    <label for="fr-case-cb">Match Case</label>
                </div>
                <div id="fr-status-msg" style="font-size: 0.78rem; color: var(--brand-yellow); min-height: 16px; margin-top: 4px;"></div>
            </div>
            <div class="modal-actions" style="flex-wrap: wrap; justify-content: space-between;">
                <div style="display: flex; gap: 6px;">
                    <button class="modal-btn btn-secondary" id="fr-btn-prev">Prev</button>
                    <button class="modal-btn btn-primary" id="fr-btn-next">Next</button>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button class="modal-btn btn-secondary" id="fr-btn-replace" style="color: var(--brand-yellow);">Replace</button>
                    <button class="modal-btn btn-danger" id="fr-btn-all">All</button>
                    <button class="modal-btn btn-secondary" onclick="closeModals()">Close</button>
                </div>
            </div>
        </div>
    </div>

    <script>
    // --- REACT NATIVE IPC RELAY LAYER ---
    let pythonListeners = [];

    // --- ZERO-DEPENDENCY SYNTH SOUND EFFECTS & HAPTICS ---
    let audioCtx = null;
    function getAudioCtx() {
        if (!audioCtx) {
            const AudioClass = window.AudioContext || window.webkitAudioContext;
            if (AudioClass) audioCtx = new AudioClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }
    // Unlock Audio Context on first interaction
    ['click', 'touchstart', 'keydown'].forEach(evt => {
        document.addEventListener(evt, () => getAudioCtx(), { once: true });
    });

    const soundFX = {
        // Crisp whoosh/pop on prompt submission (restored original tone with boosted volume)
        send: () => {
            try {
                const ctx = getAudioCtx(); if (!ctx) return;
                const now = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(280, now);
                osc.frequency.exponentialRampToValueAtTime(750, now + 0.10);
                gain.gain.setValueAtTime(0.45, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(now); osc.stop(now + 0.10);

                // Single strong 200ms continuous vibration pulse
                if (navigator.vibrate) navigator.vibrate(200);
            } catch(e) {}
        },
        // Double electronic tech blip for tool calls & tool authorization
        toolCall: () => {
            try {
                const ctx = getAudioCtx(); if (!ctx) return;
                const now = ctx.currentTime;
                [840, 1150].forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    const start = now + (i * 0.06);
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, start);
                    gain.gain.setValueAtTime(0.14, start);
                    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.06);
                    osc.connect(gain); gain.connect(ctx.destination);
                    osc.start(start); osc.stop(start + 0.06);
                });
                if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
            } catch(e) {}
        },
        // Soft confirmation blip for tool results
        toolResult: () => {
            try {
                const ctx = getAudioCtx(); if (!ctx) return;
                const now = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(540, now);
                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(now); osc.stop(now + 0.12);
            } catch(e) {}
        },
        // Harmonic 3-tone chime for incoming agent response
        agentChime: () => {
            try {
                const ctx = getAudioCtx(); if (!ctx) return;
                const now = ctx.currentTime;
                [659.25, 987.77, 1318.51].forEach((freq, i) => { // E5 -> B5 -> E6
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    const start = now + (i * 0.07);
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, start);
                    gain.gain.setValueAtTime(0.16, start);
                    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
                    osc.connect(gain); gain.connect(ctx.destination);
                    osc.start(start); osc.stop(start + 0.35);
                });
                if (navigator.vibrate) navigator.vibrate(35);
            } catch(e) {}
        }
    };

        window.electronAPI = {
            getPathForFile: (file) => file.name || '',
            openDirectoryDialog: () => {
                const path = prompt("Enter target workspace directory path:");
                if (path) window.electronAPI.sendToPython({ action: "set_directory", path: path.trim() });
            },
            openExternal: (url) => {
                if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "_open_url", url: url }));
                } else {
                    window.open(url, '_blank');
                }
            },
            renderMarkdown: (text) => {
                return renderMarkdownText(text);
            },
            escapeHtml: (text) => text ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '',
            onPythonMessage: (callback) => {
                pythonListeners.push(callback);
                return () => {
                    pythonListeners = pythonListeners.filter(cb => cb !== callback);
                };
            },
            sendToPython: (payload) => {
                if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
                }
            }
        };

        window.__receiveFromPython = function(rawMsg) {
            try {
                const msg = typeof rawMsg === 'string' ? JSON.parse(rawMsg) : rawMsg;
                if (pythonListeners.length === 0) {
                    window.__pendingQueue = window.__pendingQueue || [];
                    window.__pendingQueue.push(msg);
                } else {
                    pythonListeners.forEach(cb => cb(msg));
                }
            } catch (err) {
                console.error("[IPC Relay Parse Error]", err);
            }
        };

        window.addEventListener('message', (e) => window.__receiveFromPython(e.data));
        document.addEventListener('message', (e) => window.__receiveFromPython(e.data));

        const RANDOM_PLACEHOLDERS = [
            'Ask "what tools do you have"',
            'Ask "what memories do you have"',
            'Ask "what skills do you have"',
            'Ask "what can you do?"',
            'Ask "who are you"'
        ];

        function setRandomPlaceholder() {
            const inputEl = document.getElementById('chat-input');
            if (inputEl) {
                const choice = RANDOM_PLACEHOLDERS[Math.floor(Math.random() * RANDOM_PLACEHOLDERS.length)];
                inputEl.placeholder = choice;
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            setRandomPlaceholder();
            setTimeout(() => {
                window.electronAPI.sendToPython({ action: "get_status" });
                window.electronAPI.sendToPython({ action: "get_global_settings" });
                window.electronAPI.sendToPython({ action: "get_agent_data" });
                window.electronAPI.sendToPython({ action: "get_sessions" });
                if (window.__pendingQueue && window.__pendingQueue.length > 0) {
                    window.__pendingQueue.forEach(m => {
                        pythonListeners.forEach(cb => cb(m));
                    });
                    window.__pendingQueue = [];
                }
            }, 100);
        });

        // --- MARKDOWN & KATEX INITIALIZATION ENGINE ---
        function initMarkdownEngine() {
            if (window._markdownInitialized) return;
            if (!window.marked) return;

            try {
                const katexExt = window.markedKatex || (window['marked-katex-extension'] && window['marked-katex-extension'].default) || window['marked-katex-extension'];
                if (katexExt && typeof katexExt === 'function') {
                    window.marked.use(katexExt({
                        throwOnError: false,
                        nonStandard: true
                    }));
                }
            } catch (e) {
                console.error("KaTeX extension init error:", e);
            }

            const renderer = new window.marked.Renderer();

            // Clickable external links
            renderer.link = function(href, title, text) {
                if (typeof href === 'object' && href.href) {
                    text = href.text;
                    title = href.title;
                    href = href.href;
                }
                const titleAttr = title ? ' title="' + title + '"' : '';
                return '<a href="' + href + '" target="_blank" rel="noopener noreferrer"' + titleAttr + '>' + text + '</a>';
            };

            // Responsive Horizontal Scroll Table Container
            renderer.table = function(header, body) {
                if (typeof header === 'object' && header.header) {
                    var h = header.header;
                    var b = header.rows ? header.rows.join('') : '';
                    return '<div class="table-container"><table><thead>' + h + '</thead><tbody>' + b + '</tbody></table></div>';
                }
                return '<div class="table-container"><table><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';
            };

            // Syntax Highlighted Code Blocks with Top-Right Verbatim Copy Action
            renderer.code = function(code, language) {
                if (typeof code === 'object' && code.text) {
                    language = code.lang;
                    code = code.text;
                }
                const lang = (language || '').trim();
                const validLang = Boolean(lang && window.hljs && window.hljs.getLanguage(lang));
                let highlighted = code;
                try {
                    if (window.hljs) {
                        highlighted = validLang
                            ? window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
                            : window.hljs.highlightAuto(code).value;
                    }
                } catch (e) {
                    highlighted = code;
                }
                const langClass = validLang ? ' language-' + lang : '';
                const displayLang = lang || 'code';
                
                return '<div class="code-block-wrapper">' +
                    '<div class="code-header-bar">' +
                    '<span>' + displayLang + '</span>' +
                    '<button class="code-copy-btn" onclick="copyCodeBlock(this)">' +
                    '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>' +
                    '<span>Copy</span>' +
                    '</button>' +
                    '</div>' +
                    '<pre><code class="hljs' + langClass + '">' + highlighted + '</code></pre>' +
                    '</div>';
            };

            window.marked.setOptions({
                breaks: true,
                gfm: true,
                renderer: renderer
            });

            window._markdownInitialized = true;
        }

        // Verbatim Code Copy Handler
        window.copyCodeBlock = function(btn) {
            const wrapper = btn.closest('.code-block-wrapper');
            const codeEl = wrapper.querySelector('pre code');
            const textToCopy = codeEl.innerText || codeEl.textContent;

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textToCopy);
            } else {
                const ta = document.createElement('textarea');
                ta.value = textToCopy;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch(e) {}
                document.body.removeChild(ta);
            }

            const span = btn.querySelector('span');
            if (span) span.innerText = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                if (span) span.innerText = 'Copy';
                btn.classList.remove('copied');
            }, 2000);
        };

        function renderMarkdownText(text) {
            if (!text) return '';
            initMarkdownEngine();

            var mathList = [];

            function addBlock(mathStr) {
                var id = 'KATEXBLOCK' + mathList.length + 'KATEX';
                mathList.push({ type: 'block', math: mathStr });
                return '\\n\\n' + id + '\\n\\n';
            }

            function addInline(mathStr) {
                var id = 'KATEXINLINE' + mathList.length + 'KATEX';
                mathList.push({ type: 'inline', math: mathStr });
                return id;
            }

            // 1. Extract Display Math ($$...$$, \\[...\\], and \\begin{matrix}...\\end{matrix})
            var str = text.replace(/\\$\\$([\\s\\S]+?)\\$\\$/g, function(m, math) {
                return addBlock(math);
            });

            str = str.replace(/\\\\\\[([\\s\\S]+?)\\\\\\]/g, function(m, math) {
                return addBlock(math);
            });

            str = str.replace(/(\\\\begin\\{(?:matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|aligned|align|align\\*|equation|equation\\*|cases)\\}[\\s\\S]+?\\\\end\\{(?:matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|aligned|align|align\\*|equation|equation\\*|cases)\\})/g, function(m, math) {
                return addBlock(math);
            });

            // 2. Extract Inline Math (\\(...\\) and $...$)
            str = str.replace(/\\\\\\(([\\s\\S]+?)\\\\\\)/g, function(m, math) {
                return addInline(math);
            });

            str = str.replace(/(?<!\\\\|\\$)\\$([^\\$\\n]+?)(?<!\\\\|\\$)\\$/g, function(m, math) {
                if (/^[0-9]/.test(math.trim())) return m; // Leave currency ($5, $100) intact
                return addInline(math);
            });

            // 3. Parse Markdown (All math symbols _, &, \\\\ are protected from markdown corruption)
            var html = '';
            try {
                if (window.marked) {
                    html = window.marked.parse(str);
                } else {
                    html = str.replace(/\\n/g, '<br>');
                }
            } catch (e) {
                html = str.replace(/\\n/g, '<br>');
            }

            // 4. Unwrap paragraph wrappers around block math placeholders
            html = html.replace(/<p>\\s*(KATEXBLOCK[0-9]+KATEX)\\s*<\\/p>/g, '$1');

            // 5. Replace alphanumeric placeholders directly with compiled KaTeX HTML
            html = html.replace(/KATEX(BLOCK|INLINE)([0-9]+)KATEX/g, function(m, type, idxStr) {
                var idx = parseInt(idxStr, 10);
                var item = mathList[idx];
                if (!item) return m;

                var isBlock = (item.type === 'block');
                try {
                    if (window.katex) {
                        return window.katex.renderToString(item.math.trim(), {
                            displayMode: isBlock,
                            throwOnError: false
                        });
                    }
                } catch (e) {
                    console.error("KaTeX compilation error:", e);
                }
                return isBlock ? '$$' + item.math + '$$' : '$' + item.math + '$';
            });

            return html;
        }

        // Post-processing KaTeX pass supporting matrix environments
        function applyLatexPass(element) {
            if (window.renderMathInElement && element) {
                try {
                    window.renderMathInElement(element, {
                        delimiters: [
                            { left: '$$', right: '$$', display: true },
                            { left: '$', right: '$', display: false },
                            { left: '\\\\(', right: '\\\\)', display: false },
                            { left: '\\\\[', right: '\\\\]', display: true },
                            { left: '\\\\begin{bmatrix}', right: '\\\\end{bmatrix}', display: true },
                            { left: '\\\\begin{pmatrix}', right: '\\\\end{pmatrix}', display: true },
                            { left: '\\\\begin{matrix}', right: '\\\\end{matrix}', display: true },
                            { left: '\\\\begin{aligned}', right: '\\\\end{aligned}', display: true },
                            { left: '\\\\begin{equation}', right: '\\\\end{equation}', display: true },
                            { left: '\\\\begin{cases}', right: '\\\\end{cases}', display: true },
                            { left: '\\\\begin{align}', right: '\\\\end{align}', display: true }
                        ],
                        throwOnError: false
                    });
                } catch (e) {
                    console.error("KaTeX Auto-Render error:", e);
                }
            }
        }

        // --- RENDERER ENGINE ---
        const chatContainer = document.getElementById('chat-container');
        const chatInput = document.getElementById('chat-input');
        const inputCapsule = document.getElementById('input-capsule-dropzone');
        const statusMode = document.getElementById('status-mode');
        const workingIndicator = document.getElementById('working-indicator');
        const workingText = document.getElementById('working-text');
        const reactorCanvas = document.getElementById('reactor-canvas');
        const reactorCtx = reactorCanvas ? reactorCanvas.getContext('2d') : null;
        const suggestionsPopup = document.getElementById('suggestions-popup');
        const sidebar = document.getElementById('sidebar');
        const sidebarOverlay = document.getElementById('sidebar-overlay');
        const drawerRecentsList = document.getElementById('drawer-recents-list');
        const btnToggleAllSessions = document.getElementById('btn-toggle-all-sessions');
        const welcomeHero = document.getElementById('welcome-hero');
        const headerAgentDropdown = document.getElementById('header-agent-dropdown');
        const dropdownAgentsList = document.getElementById('dropdown-agents-list');
        const headerAgentSearch = document.getElementById('header-agent-search');

        let reactorAnimId = null;
        let reactorAngle = 0;
        let reactorColor = "#3ddbd9";
        const workingAgentsMap = new Map();
        let sessionToken = null;
        let currentCallId = null;
        let currentSuggestions = [];
        let selectedSuggestionIdx = -1;
        let currentPrefix = "";
        let cachedUserName = localStorage.getItem("federaide-username") || "User";
        let cachedUserColor = localStorage.getItem("federaide-usercolor") || "#dda0dd";
        let cachedAgents = [];
        let activeAgentName = "Rita";
        let cachedSessions = [];
        let showAllSessions = false;
        let activeAIMessageBlock = null;
        let activeAIMessageBody = null;

        function hexToRgba(hex, alpha = 1) {
            let c = (hex || '#3ddbd9').replace('#', '');
            if (c.length === 3) c = c.split('').map(x => x + x).join('');
            const num = parseInt(c, 16) || 0;
            return 'rgba(' + ((num >> 16) & 255) + ',' + ((num >> 8) & 255) + ',' + (num & 255) + ',' + alpha + ')';
        }

        function drawReactorFrame() {
            if (!reactorCtx) return;
            const w = 36, h = 36, cx = 18, cy = 18;
            reactorCtx.clearRect(0, 0, w, h);
            reactorAngle += 0.07;

            const nucleusPulse = 2.0 + Math.sin(reactorAngle * 2.5) * 0.4;
            reactorCtx.beginPath();
            reactorCtx.arc(cx, cy, nucleusPulse, 0, Math.PI * 2);
            reactorCtx.fillStyle = '#ffffff';
            reactorCtx.shadowColor = reactorColor;
            reactorCtx.shadowBlur = 8;
            reactorCtx.fill();
            reactorCtx.shadowBlur = 0;

            const orbits = [
                { tilt: 0, rx: 13.5, ry: 4.8, speed: 1.0, offset: 0 },
                { tilt: Math.PI / 3, rx: 13.5, ry: 4.8, speed: 1.2, offset: 2.1 },
                { tilt: (2 * Math.PI) / 3, rx: 13.5, ry: 4.8, speed: -1.1, offset: 4.2 }
            ];

            const trailSegments = 20;
            const maxTrailAngle = Math.PI;

            orbits.forEach(orb => {
                reactorCtx.save();
                reactorCtx.translate(cx, cy);
                reactorCtx.rotate(orb.tilt);

                const currentPhase = reactorAngle * orb.speed + orb.offset;
                const direction = orb.speed >= 0 ? 1 : -1;

                for (let i = 0; i < trailSegments; i++) {
                    const frac1 = i / trailSegments;
                    const frac2 = (i + 1) / trailSegments;
                    const t1 = currentPhase - direction * (frac1 * maxTrailAngle);
                    const t2 = currentPhase - direction * (frac2 * maxTrailAngle);
                    const alpha = Math.pow(1 - frac1, 2.2) * 0.85;
                    const lineWidth = Math.max(0.5, (1 - frac1) * 1.8);

                    reactorCtx.beginPath();
                    reactorCtx.ellipse(0, 0, orb.rx, orb.ry, 0, direction > 0 ? t2 : t1, direction > 0 ? t1 : t2, false);
                    reactorCtx.strokeStyle = hexToRgba(reactorColor, alpha);
                    reactorCtx.lineWidth = lineWidth;
                    reactorCtx.stroke();
                }

                const ex = orb.rx * Math.cos(currentPhase);
                const ey = orb.ry * Math.sin(currentPhase);
                reactorCtx.beginPath();
                reactorCtx.arc(ex, ey, 1.5, 0, Math.PI * 2);
                reactorCtx.fillStyle = '#ffffff';
                reactorCtx.shadowColor = reactorColor;
                reactorCtx.shadowBlur = 8;
                reactorCtx.fill();
                reactorCtx.restore();
            });

            reactorAnimId = requestAnimationFrame(drawReactorFrame);
        }

        function startReactorAnimation(color = "#3ddbd9") {
            reactorColor = color;
            if (!reactorAnimId) drawReactorFrame();
        }

        function stopReactorAnimation() {
            if (reactorAnimId) {
                cancelAnimationFrame(reactorAnimId);
                reactorAnimId = null;
            }
        }

        function updateMultiAgentWorkingState(agentName, isWorking, color) {
            if (!agentName) return;
            if (isWorking) {
                workingAgentsMap.set(agentName, color || getAgentColor(agentName));
            } else {
                workingAgentsMap.delete(agentName);
            }

            const activeList = Array.from(workingAgentsMap.entries());
            if (activeList.length === 0) {
                workingIndicator.style.display = "none";
                stopReactorAnimation();
                workingText.innerHTML = "";
                return;
            }

            workingIndicator.style.display = "flex";
            const primaryColor = activeList[0][1] || "var(--brand-teal)";
            startReactorAnimation(primaryColor);

            if (activeList.length === 1) {
                const [name, c] = activeList[0];
                workingText.innerHTML = '<span style="color:' + c + '; font-weight:600;">' + window.electronAPI.escapeHtml(name) + '</span> is working...';
            } else {
                workingText.innerHTML = '<span style="color:var(--brand-primary); font-weight:600;">' + activeList.length + ' agents</span> are collaborating...';
            }
        }

        function sendToPython(payload) {
            window.electronAPI.sendToPython(payload);
        }

        function stripRichTags(text) {
            if (!text) return "";
            return text.replace(/\\[\\/\\]/g, "").replace(/\\[\\/?(bold|dim|italic|underline|\\#[a-fA-F0-9]{6}|[a-zA-Z]+)(?:\\s+[a-zA-Z0-9#_]+)?\\]/g, "");
        }

        function closeModals() {
            document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
            headerAgentDropdown.classList.remove('open');
            if (typeof resetScheduleForm === 'function') resetScheduleForm();
            chatInput.focus();
        }

        // --- ONBOARDING MODAL ENGINE ---
        function showOnboardingModal() {
            const modal = document.getElementById('onboarding-modal');
            if (!modal) return;

            // Ensure keyring modal is dismissed before opening onboarding
            const keyringModal = document.getElementById('keyring-modal');
            if (keyringModal) keyringModal.style.display = 'none';

            syncColorPicker('onboard-color-picker', 'onboard-color', '#3ddbd9');

            const presetSelect = document.getElementById('onboard-base-preset');
            const baseUrlInput = document.getElementById('onboard-base-url');
            const modelInput = document.getElementById('onboard-model');
            const authBtn = document.getElementById('btn-onboard-chatgpt-auth');
            const apiKeyInput = document.getElementById('onboard-api-key');
            const apiKeyLabel = document.getElementById('onboard-api-key-label');
            const statusEl = document.getElementById('onboard-chatgpt-status');

            function updateOnboardPreset(val) {
                if (val !== 'custom') {
                    baseUrlInput.value = val;
                }
                if (val === "https://generativelanguage.googleapis.com/v1beta/openai/") {
                    modelInput.value = "gemini-3.5-flash-lite";
                } else if (val === "https://openrouter.ai/api/v1") {
                    modelInput.value = "google/gemini-3.5-flash-lite";
                } else if (val === "https://api.openai.com/v1/") {
                    modelInput.value = "gpt-5.5";
                } else if (val === "https://api.anthropic.com/v1/") {
                    modelInput.value = "claude-3-5-sonnet";
                } else if (val === "https://chatgpt.com/backend-api/codex") {
                    modelInput.value = "gpt-5.5";
                }

                if (val === "https://chatgpt.com/backend-api/codex") {
                    authBtn.style.display = "block";
                    apiKeyInput.style.display = "none";
                    apiKeyLabel.style.display = "none";
                    if (statusEl) statusEl.style.display = "block";
                } else {
                    authBtn.style.display = "none";
                    apiKeyInput.style.display = "block";
                    apiKeyLabel.style.display = "block";
                    if (statusEl) {
                        statusEl.style.display = "none";
                        statusEl.innerHTML = '';
                    }
                }
            }

            if (presetSelect && !presetSelect._hasListener) {
                presetSelect.addEventListener('change', (e) => updateOnboardPreset(e.target.value));
                presetSelect._hasListener = true;
            }

            if (authBtn && !authBtn._hasListener) {
                authBtn.onclick = () => {
                    authBtn.disabled = true;
                    authBtn.innerText = '⏳ Waiting for browser sign-in...';
                    if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-teal);">Please complete sign-in in your browser...</span>';
                    sendToPython({ action: "start_chatgpt_oauth" });
                };
                authBtn._hasListener = true;
            }

            modal.style.display = 'flex';
            setTimeout(() => { document.getElementById('onboard-api-key')?.focus(); }, 100);
        }

        document.addEventListener('DOMContentLoaded', () => {
            const btnSubmit = document.getElementById('btn-onboard-submit');
            if (btnSubmit) {
                btnSubmit.onclick = () => {
                    const name = (document.getElementById('onboard-name')?.value || '').trim();
                    const model = (document.getElementById('onboard-model')?.value || '').trim();
                    const baseUrl = (document.getElementById('onboard-base-url')?.value || '').trim();
                    let apiKey = (document.getElementById('onboard-api-key')?.value || '').trim();
                    const preset = document.getElementById('onboard-base-preset')?.value;
                    const statusMsg = document.getElementById('onboard-status-msg');

                    if (preset === "https://chatgpt.com/backend-api/codex" && !apiKey) {
                        apiKey = "CHATGPT_OAUTH_ACTIVE";
                    }

                    if (!apiKey) {
                        if (statusMsg) statusMsg.innerHTML = '<span style="color: var(--brand-red);">API Key cannot be empty.</span>';
                        return;
                    }
                    if (!name) {
                        if (statusMsg) statusMsg.innerHTML = '<span style="color: var(--brand-red);">Agent name cannot be empty.</span>';
                        return;
                    }

                    btnSubmit.disabled = true;
                    btnSubmit.innerText = '⏳ Verifying Credentials & Translating...';
                    if (statusMsg) statusMsg.innerHTML = '<span style="color: var(--brand-yellow);">Testing API connection & backstory...</span>';

                    const fields = {
                        name: name,
                        color: (document.getElementById('onboard-color')?.value || '#3ddbd9').trim(),
                        backstory: (document.getElementById('onboard-backstory')?.value || '').trim(),
                        model: model,
                        reasoning_effort: 'none',
                        temperature: 1.0,
                        base_url: baseUrl,
                        api_key: apiKey,
                        tts_voice: 'af_sarah',
                        pronouns: 'she/her',
                        is_capable_vision: true,
                        disable_all_tools: false,
                        use_backup: false,
                        backup_model: '',
                        backup_base_url: '',
                        backup_api_key: '',
                        enabled_tools: ["read_file", "fetch_url"],
                        disabled_tools: ["visual_computer_operation", "send_file_to_telegram"]
                    };

                    sendToPython({
                        action: "save_agent_data",
                        fields,
                        is_new: false,
                        old_name: name
                    });
                };
            }
        });

        function toggleDrawer(open) {
            if (open) {
                sidebar.classList.add('open');
                sidebarOverlay.classList.add('active');
                sendToPython({ action: "get_sessions" });
            } else {
                sidebar.classList.remove('open');
                sidebarOverlay.classList.remove('active');
            }
        }

        function adjustTextareaHeight() {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
        }

        function setPromptText(text) {
            chatInput.value = text;
            adjustTextareaHeight();
            chatInput.focus();
        }

        function updateViewportHeight() {
            if (window.visualViewport) {
                const vh = window.visualViewport.height;
                const offsetTop = window.visualViewport.offsetTop || 0;
                const appMain = document.getElementById('app-main');
                if (appMain) {
                    appMain.style.height = vh + 'px';
                    appMain.style.top = offsetTop + 'px';
                }
            }
            if (window.scrollY !== 0 || window.scrollX !== 0) {
                window.scrollTo(0, 0);
            }
            document.body.scrollTop = 0;
            document.documentElement.scrollTop = 0;
        }

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateViewportHeight);
            window.visualViewport.addEventListener('scroll', () => {
                updateViewportHeight();
            });
        }
        window.addEventListener('resize', updateViewportHeight);
        window.addEventListener('scroll', () => {
            updateViewportHeight();
        });

        // Prevent root document bounce/pull from lifting the entry dock
        document.addEventListener('touchmove', (e) => {
            if (!e.target.closest('#chat-container') && 
                !e.target.closest('.modal-body') && 
                !e.target.closest('.sidebar-scroll') && 
                !e.target.closest('.dropdown-agents-list') && 
                !e.target.closest('#suggestions-popup') && 
                !e.target.closest('#chat-input')) {
                e.preventDefault();
            }
        }, { passive: false });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#btn-header-agent-pill') && !e.target.closest('#header-agent-dropdown')) {
                headerAgentDropdown.classList.remove('open');
            }
            const link = e.target.closest('a');
            if (link && link.href) {
                const href = link.getAttribute('href') || link.href;
                if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
                    e.preventDefault();
                    window.electronAPI.openExternal(link.href);
                }
            }
        });

        // Theme Toggle & Persistence
        function applyTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            try { localStorage.setItem('federaide-theme', theme); } catch(e) {}
            const sunIcon = document.getElementById('theme-sun-icon');
            const moonIcon = document.getElementById('theme-moon-icon');
            if (theme === 'light') {
                sunIcon.style.display = 'none';
                moonIcon.style.display = 'block';
            } else {
                sunIcon.style.display = 'block';
                moonIcon.style.display = 'none';
            }
        }

        function initTheme() {
            let savedTheme = 'dark';
            try { savedTheme = localStorage.getItem('federaide-theme') || 'dark'; } catch(e) {}
            applyTheme(savedTheme);
        }

        document.getElementById('btn-theme-toggle').onclick = () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            applyTheme(current === 'dark' ? 'light' : 'dark');
        };

        initTheme();

        document.getElementById('btn-abort').onclick = () => {
            sendToPython({ action: "abort" });
            workingAgentsMap.clear();
            workingIndicator.style.display = "none";
            stopReactorAnimation();
            appendLog("[bold red]Operation Aborted by User.[/bold red]", false);
        };

        // Header Agent Dropdown
        function renderHeaderAgentDropdown(filter = "") {
            dropdownAgentsList.innerHTML = '';
            const q = filter.toLowerCase().trim();
            const agentsList = (cachedAgents && cachedAgents.length > 0) 
                ? cachedAgents 
                : [{ name: activeAgentName || "Rita", color: "var(--brand-teal)", model: "Default" }];
                
            const filtered = agentsList.filter(a => a.name.toLowerCase().includes(q));

            filtered.forEach(a => {
                const isActive = (a.name.toLowerCase() === activeAgentName.toLowerCase());
                const item = document.createElement('div');
                item.className = 'dropdown-agent-item ' + (isActive ? 'active' : '');
                item.innerHTML = '<div style="display:flex; align-items:center; gap:8px;">' +
                    '<span style="width:10px; height:10px; border-radius:50%; background:' + (a.color || 'var(--brand-teal)') + '; flex-shrink:0;"></span>' +
                    '<span style="font-weight:' + (isActive ? '700' : '500') + ';">' + a.name + '</span>' +
                    '</div>' +
                    '<span style="font-size:0.75rem; color:var(--text-dim);">' + (a.model ? (a.model.split('/')[1] || a.model) : '') + (isActive ? ' ✓' : '') + '</span>';
                item.onclick = (e) => {
                    e.stopPropagation();
                    activeAgentName = a.name;
                    updateHeaderAgentPill(a.name, a.color);
                    sendToPython({ action: "select_agent", name: a.name });
                    headerAgentDropdown.classList.remove('open');
                    sendToPython({ action: "get_agent_data", name: a.name });
                };
                dropdownAgentsList.appendChild(item);
            });

            if (filtered.length === 0) {
                const empty = document.createElement('div');
                empty.style.fontSize = '0.8rem';
                empty.style.color = 'var(--text-dim)';
                empty.style.padding = '0.5rem';
                empty.innerText = 'No agents matching "' + filter + '"';
                dropdownAgentsList.appendChild(empty);
            }
        }

        document.getElementById('btn-header-agent-pill').onclick = (e) => {
            e.stopPropagation();
            headerAgentDropdown.classList.toggle('open');
            if (headerAgentDropdown.classList.contains('open')) {
                sendToPython({ action: "get_status" });
                sendToPython({ action: "get_agent_data" });
                renderHeaderAgentDropdown(headerAgentSearch.value);
                headerAgentSearch.focus();
            }
        };

        headerAgentSearch.addEventListener('input', (e) => renderHeaderAgentDropdown(e.target.value));

        // Drawer Controls
        document.getElementById('btn-open-drawer').onclick = () => toggleDrawer(true);
        document.getElementById('btn-close-drawer').onclick = () => toggleDrawer(false);
        sidebarOverlay.onclick = () => toggleDrawer(false);

        document.getElementById('btn-tray-new-chat').onclick = () => {
            sendToPython({ action: "clear_all" });
            toggleDrawer(false);
        };
        
        // Open native RN termux console
        document.getElementById('btn-tray-termux').onclick = () => {
            toggleDrawer(false);
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: "_open_termux_console" }));
            }
        };

        document.getElementById('btn-tray-settings').onclick = () => {
            toggleDrawer(false);
            openGlobalSettings();
        };
        document.getElementById('btn-tray-agent-edit').onclick = () => {
            toggleDrawer(false);
            openAgentConfig();
        };
        document.getElementById('btn-tray-schedules').onclick = () => {
            toggleDrawer(false);
            openSchedulesModal();
        };
        let currentWorkspaceRelPath = "";
        let pendingDeleteItem = null;

        function openWorkspaceModal(relPath = "") {
            currentWorkspaceRelPath = relPath;
            document.getElementById('ws-breadcrumb').innerText = "FederateWorkspace" + (relPath ? "/" + relPath : "");
            sendToPython({ action: "list_workspace", path: relPath });
            document.getElementById('workspace-modal').style.display = 'flex';
        }

        document.getElementById('btn-ws-up').onclick = () => {
            if (!currentWorkspaceRelPath) return;
            const parts = currentWorkspaceRelPath.split("/").filter(Boolean);
            parts.pop();
            openWorkspaceModal(parts.join("/"));
        };

        document.getElementById('btn-tray-directory').onclick = () => {
            toggleDrawer(false);
            openWorkspaceModal("");
        };

        document.getElementById('btn-ws-clear-cache').onclick = () => {
            const btn = document.getElementById('btn-ws-clear-cache');
            if (btn) {
                btn.classList.add('btn-clearing');
                const txt = btn.querySelector('.btn-text');
                if (txt) txt.innerText = 'Sweeping...';
            }
            sendToPython({ action: "clear_workspace_cache" });
        };

        document.getElementById('btn-confirm-delete').onclick = () => {
            if (pendingDeleteItem) {
                sendToPython({
                    action: "delete_workspace_item",
                    path: pendingDeleteItem.path,
                    is_folder: pendingDeleteItem.is_folder
                });
                document.getElementById('delete-confirm-modal').style.display = 'none';
                pendingDeleteItem = null;
            }
        };

        function renderDrawerRecents() {
            drawerRecentsList.innerHTML = '';
            const namedSessions = cachedSessions.filter(s => s.name && !s.name.startsWith("sess_"));
            const displayList = showAllSessions ? cachedSessions : namedSessions.slice(0, 10);

            if (displayList.length === 0) {
                const empty = document.createElement('div');
                empty.style.color = 'var(--text-dim)';
                empty.style.fontSize = '0.8rem';
                empty.style.padding = '0.5rem 0';
                empty.innerText = 'No conversations yet.';
                drawerRecentsList.appendChild(empty);
                btnToggleAllSessions.style.display = 'none';
                return;
            }

            displayList.forEach(s => {
                const item = document.createElement('div');
                item.className = 'recent-chat-item';
                item.innerText = s.name || s.id;
                item.title = s.name || s.id;
                item.onclick = () => {
                    sendToPython({ action: "load_session", path: s.path });
                    toggleDrawer(false);
                };
                drawerRecentsList.appendChild(item);
            });

            btnToggleAllSessions.style.display = cachedSessions.length > 10 ? 'block' : 'none';
            btnToggleAllSessions.innerText = showAllSessions ? "Show less" : "... View all conversations";
        }

        btnToggleAllSessions.onclick = () => {
            showAllSessions = !showAllSessions;
            renderDrawerRecents();
        };

        // --- IPC INCOMING DISPATCHER ---
        window.electronAPI.onPythonMessage((msg) => {
            try {
                switch (msg.type) {
                    case "init":
                        if (msg.session_token) sessionToken = msg.session_token;
                        if (msg.agents && msg.agents.length > 0) {
                            cachedAgents = msg.agents;
                        }
                        if (msg.active_agent) {
                            activeAgentName = msg.active_agent;
                        }
                        const currentAgent = cachedAgents.find(a => a.name === activeAgentName);
                        updateHeaderAgentPill(activeAgentName, currentAgent ? currentAgent.color : null);
                        renderHeaderAgentDropdown(headerAgentSearch.value);

                        if (msg.needs_onboarding) {
                            showOnboardingModal();
                        }
                        
                        // Retroactively fix tails now that we definitively know who the agents are
                        document.querySelectorAll('.ai-bubble-card').forEach(card => {
                            const sName = card.dataset.sender || "";
                            const isTool = card.dataset.isToolCall === "true";
                            const isCardUser = !isTool && (
                                sName.toLowerCase() === (cachedUserName || "user").toLowerCase() ||
                                sName.toLowerCase().startsWith("telegram") ||
                                sName.toLowerCase() === "user"
                            );
                            if (isTool) {
                                card.style.cssText = 'border-radius: 18px !important;';
                            } else if (isCardUser) {
                                card.style.cssText = 'border-radius: 18px 18px 4px 18px !important;';
                            } else {
                                card.style.cssText = 'border-radius: 18px 18px 18px 4px !important;';
                            }
                        });
                        
                        sendToPython({ action: "get_sessions" });
                        break;

                    

                    case "keyring_unlock_required":
                        document.getElementById('keyring-modal').style.display = 'flex';
                        document.getElementById('keyring-password-input').focus();
                        break;

                    case "keyring_unlock_success":
                        document.getElementById('keyring-modal').style.display = 'none';
                        document.getElementById('keyring-password-input').value = '';
                        document.getElementById('keyring-error-msg').innerText = '';
                        break;

                    case "keyring_unlock_failed":
                        document.getElementById('keyring-error-msg').innerText = msg.error || "Unlock failed.";
                        break;

                    case "agent_selected":
                        activeAgentName = msg.name;
                        updateHeaderAgentPill(msg.name, msg.color);
                        break;

                    case "open_external_url":
                        if (msg.url) {
                            window.electronAPI.openExternal(msg.url);
                        }
                        break;

                    case "chatgpt_oauth_status": {
                        const authBtn = document.getElementById('btn-chatgpt-auth');
                        const statusEl = document.getElementById('chatgpt-auth-status');
                        const apiKeyInput = document.getElementById('cfg-agent-api-key');

                        const onboardAuthBtn = document.getElementById('btn-onboard-chatgpt-auth');
                        const onboardStatusEl = document.getElementById('onboard-chatgpt-status');
                        const onboardApiKeyInput = document.getElementById('onboard-api-key');

                        if (msg.status === "success") {
                            // Agent Config Modal updates
                            if (authBtn) {
                                authBtn.disabled = false;
                                authBtn.innerText = '✓ Authenticated with ChatGPT';
                                authBtn.style.background = 'var(--brand-green)';
                                authBtn.style.color = '#000';
                            }
                            if (statusEl) {
                                statusEl.innerHTML = '<span style="color: var(--brand-green);">✓ ' + window.electronAPI.escapeHtml(msg.message) + '</span>';
                            }
                            if (apiKeyInput) {
                                apiKeyInput.value = 'CHATGPT_OAUTH_ACTIVE';
                            }

                            // Onboarding Modal updates
                            if (onboardAuthBtn) {
                                onboardAuthBtn.disabled = false;
                                onboardAuthBtn.innerText = '✓ Authenticated with ChatGPT';
                                onboardAuthBtn.style.background = 'var(--brand-green)';
                                onboardAuthBtn.style.color = '#000';
                            }
                            if (onboardStatusEl) {
                                onboardStatusEl.innerHTML = '<span style="color: var(--brand-green);">✓ ' + window.electronAPI.escapeHtml(msg.message) + '</span>';
                            }
                            if (onboardApiKeyInput) {
                                onboardApiKeyInput.value = 'CHATGPT_OAUTH_ACTIVE';
                            }
                        } else if (msg.status === "failed") {
                            if (authBtn) {
                                authBtn.disabled = false;
                                authBtn.innerText = 'Authenticate with ChatGPT (OAuth)';
                                authBtn.style.background = 'var(--brand-primary)';
                                authBtn.style.color = '#000';
                            }
                            if (statusEl) {
                                statusEl.innerHTML = '<span style="color: var(--brand-red);">✗ ' + window.electronAPI.escapeHtml(msg.message) + '</span>';
                            }
                            if (onboardAuthBtn) {
                                onboardAuthBtn.disabled = false;
                                onboardAuthBtn.innerText = 'Authenticate with ChatGPT (OAuth)';
                                onboardAuthBtn.style.background = 'var(--brand-green)';
                                onboardAuthBtn.style.color = '#000';
                            }
                            if (onboardStatusEl) {
                                onboardStatusEl.innerHTML = '<span style="color: var(--brand-red);">✗ ' + window.electronAPI.escapeHtml(msg.message) + '</span>';
                            }
                        }
                        break;
                    }

                    case "log":
                        appendLog(msg.content, msg.is_markdown);
                        break;

                    case "message_block":
                        appendMessageBlock(msg.header, msg.content, msg.color, msg.is_markdown, !!msg.silent);
                        break;

                    case "mount_progress":
                        mountProgress(msg.tasks);
                        break;

                    case "update_progress":
                        updateProgress(msg.task, msg.percent, msg.log);
                        break;

                    case "hide_progress":
                        hideProgress();
                        break;

                    case "mount_ai_box":
                        mountAIBox(msg.agent_name, msg.color);
                        break;

                    case "update_ai_box":
                        updateAIBox(msg.content);
                        break;

                    case "tool_result":
                        appendToolResult("Result", msg.agent, msg.color, msg.summary, false, !!msg.silent);
                        break;

                    case "tool_error":
                        appendToolResult("Error", msg.agent, msg.color, msg.summary, true, !!msg.silent);
                        break;

                    case "spinner":
                        updateMultiAgentWorkingState(msg.agent, !!msg.show, msg.color);
                        break;

                    case "status_bar":
                        updateStatusBar(msg);
                        break;

                    case "clear_chat":
                        window._isReplayingHistory = true;
                        setTimeout(() => { window._isReplayingHistory = false; }, 400);
                        chatContainer.innerHTML = '';
                        if (welcomeHero) {
                            welcomeHero.style.display = 'block';
                            chatContainer.appendChild(welcomeHero);
                        }
                        activeAIMessageBlock = null;
                        activeAIMessageBody = null;
                        workingAgentsMap.clear();
                        workingIndicator.style.display = "none";
                        stopReactorAnimation();
                        chatContainer.scrollTop = 0;
                        break;

                    case "confirm_tool":
                        showToolModal(msg);
                        break;

                    case "suggestions":
                        renderSuggestions(msg);
                        break;

                    case "agent_data":
                        populateAgentModal(msg.data, msg.all_tools, msg.all_agent_names);
                        break;

                    case "agent_save_status": {
                        const saveBtn = document.getElementById('btn-save-agent');
                        const saveNewBtn = document.getElementById('btn-save-as-new');
                        const onboardBtn = document.getElementById('btn-onboard-submit');
                        const onboardStatus = document.getElementById('onboard-status-msg');
                        const onboardModal = document.getElementById('onboarding-modal');

                        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerText = 'Save Changes'; }
                        if (saveNewBtn) { saveNewBtn.disabled = false; saveNewBtn.innerText = 'Save As New'; }
                        if (onboardBtn) { onboardBtn.disabled = false; onboardBtn.innerText = '🚀 Initialize Agent & Start'; }

                        if (msg.status === "success") {
                            closeModals();
                            const hero = document.getElementById('welcome-hero');
                            if (hero) hero.style.display = 'block';
                        } else if (msg.status === "failed") {
                            if (onboardStatus && onboardModal && onboardModal.style.display === 'flex') {
                                onboardStatus.innerHTML = '<span style="color: var(--brand-red);">✗ Verification failed: ' + window.electronAPI.escapeHtml(msg.error || 'Check key & model.') + '</span>';
                            } else {
                                appendLog('[bold red]Agent verification failed:[/] ' + window.electronAPI.escapeHtml(msg.error || 'Please check your API key, model name, and base URL.'), false);
                            }
                        }
                        break;
                    }

                    case "global_settings_data":
                        if (msg.data) {
                            if (msg.data.user_name) {
                                cachedUserName = msg.data.user_name;
                                localStorage.setItem("federaide-username", cachedUserName);
                            }
                            if (msg.data.user_color) {
                                cachedUserColor = msg.data.user_color;
                                localStorage.setItem("federaide-usercolor", cachedUserColor);
                            }
                            // Retroactively fix tails and colors for user messages
                            document.querySelectorAll('.ai-bubble-card').forEach(card => {
                                const sName = card.dataset.sender || "";
                                const isTool = card.dataset.isToolCall === "true";
                                const isCardUser = !isTool && (
                                    sName.toLowerCase() === (cachedUserName || "user").toLowerCase() ||
                                    sName.toLowerCase().startsWith("telegram") ||
                                    sName.toLowerCase() === "user"
                                );
                                if (isTool) {
                                    card.style.cssText = 'border-radius: 18px !important;';
                                } else if (isCardUser) {
                                    card.style.cssText = 'border-radius: 18px 18px 4px 18px !important;';
                                    const parentBlock = card.closest('.message-block');
                                    if (parentBlock && cachedUserColor) {
                                        parentBlock.style.setProperty('--agent-accent', cachedUserColor);
                                    }
                                    const headerEl = card.querySelector('.message-header');
                                    if (headerEl && cachedUserColor) {
                                        headerEl.style.color = cachedUserColor;
                                    }
                                } else {
                                    card.style.cssText = 'border-radius: 18px 18px 18px 4px !important;';
                                }
                            });
                            populateGlobalSettingsModal(msg.data);
                        }
                        break;

                    case "sessions_list_data":
                        cachedSessions = msg.sessions || [];
                        renderDrawerRecents();
                        break;

                    case "schedules_data":
                        renderSchedulesList(msg.tasks || []);
                        break;

                    case "workspace_list": {
                        const listEl = document.getElementById('ws-file-list');
                        listEl.innerHTML = '';
                        if (!msg.items || msg.items.length === 0) {
                            listEl.innerHTML = '<div style="color:var(--text-dim);font-size:0.82rem;padding:0.5rem 0;">Directory is empty.</div>';
                            break;
                        }
                        msg.items.forEach(item => {
                            const row = document.createElement('div');
                            row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-radius:8px; background:var(--bg-card);';
                            
                            const nameSpan = document.createElement('span');
                            nameSpan.style.cssText = 'cursor:pointer; font-size:0.85rem; display:flex; align-items:center; gap:6px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                            nameSpan.innerHTML = (item.is_dir ? '📁 ' : '📄 ') + window.electronAPI.escapeHtml(item.name) + (!item.is_dir ? ' <span style="font-size:0.7rem;color:var(--text-dim);">(' + (item.size > 1048576 ? (item.size/1048576).toFixed(1) + 'MB' : (item.size/1024).toFixed(1) + 'KB') + ')</span>' : '');
                            
                            if (item.is_dir) {
                                nameSpan.onclick = () => openWorkspaceModal(msg.current_path ? msg.current_path + "/" + item.name : item.name);
                            }

                            const itemFullPath = msg.current_path ? msg.current_path + "/" + item.name : item.name;

                            const btnGroup = document.createElement('div');
                            btnGroup.style.cssText = 'display:flex; gap:4px; align-items:center;';

                            const shareBtn = document.createElement('button');
                            shareBtn.className = 'modal-btn ' + (item.is_dir ? 'btn-secondary' : 'btn-primary');
                            shareBtn.style.cssText = 'padding:3px 8px; font-size:0.72rem;';
                            shareBtn.innerText = item.is_dir ? 'ZIP 📦' : 'Share ↗';
                            shareBtn.onclick = () => {
                                shareBtn.innerText = '...';
                                sendToPython({ 
                                    action: "prepare_share", 
                                    path: itemFullPath, 
                                    is_folder: item.is_dir 
                                });
                            };

                            const delBtn = document.createElement('button');
                            delBtn.className = 'modal-btn btn-secondary';
                            delBtn.style.cssText = 'padding:3px 6px; font-size:0.72rem; color:var(--brand-red);';
                            delBtn.innerText = '🗑️';
                            delBtn.title = 'Delete';
                            delBtn.onclick = () => {
                                pendingDeleteItem = { path: itemFullPath, is_folder: item.is_dir };
                                document.getElementById('del-item-name').innerText = (item.is_dir ? '📁 ' : '📄 ') + itemFullPath;
                                document.getElementById('delete-confirm-modal').style.display = 'flex';
                            };

                            btnGroup.appendChild(shareBtn);
                            btnGroup.appendChild(delBtn);

                            row.appendChild(nameSpan);
                            row.appendChild(btnGroup);
                            listEl.appendChild(row);
                        });
                        break;
                    }

                    case "share_file_path": {
                        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                            window.ReactNativeWebView.postMessage(JSON.stringify({
                                type: "_share_file_path",
                                filename: msg.filename,
                                path: msg.path,
                                mime_type: msg.mime_type || "application/octet-stream"
                            }));
                        }
                        const btns = document.querySelectorAll('#ws-file-list button');
                        btns.forEach(b => { if (b.innerText === '...') b.innerText = b.classList.contains('btn-secondary') ? 'ZIP 📦' : 'Share ↗'; });
                        break;
                    }

                    case "workspace_cache_cleared": {
                        const btn = document.getElementById('btn-ws-clear-cache');
                        if (btn) {
                            btn.classList.remove('btn-clearing');
                            btn.classList.add('btn-cleared');
                            const count = msg.count || 0;
                            btn.innerHTML = '<span class="sweep-icon">✨</span> <span class="btn-text">Cleared (' + count + ')</span>';
                            
                            setTimeout(() => {
                                btn.classList.remove('btn-cleared');
                                btn.innerHTML = '<span class="sweep-icon">🧹</span> <span class="btn-text">Clear Cache</span>';
                            }, 2000);
                        }
                        appendLog('[bold green]🧹 Workspace shared cache cleared successfully.[/bold green]', false);
                        break;
                    }
                }
            } catch (err) {
                console.error("IPC Message Handler Error:", err);
            }
        });

        function updateHeaderAgentPill(name, color) {
            const label = document.getElementById('header-agent-name');
            const dot = document.getElementById('header-agent-dot');
            if (label) label.innerText = name;
            if (dot && color) dot.style.background = color;
        }

        let currentAgentMode = "PLAN";

        function updateStatusBar(msg) {
            if (msg.mode) {
                currentAgentMode = msg.mode;
            }
            const label = document.getElementById('tray-cwd-label');
            if (label && msg.cwd) {
                const parts = msg.cwd.split(/[\\/\\\\]/);
                label.innerText = parts[parts.length - 1] || msg.cwd;
            }
            const modeMap = { PLAN: "SAFE", INTERMEDIATE: "SEMI-AUTO", EXECUTE: "FULL-AUTO" };
            const displayMode = modeMap[currentAgentMode] || currentAgentMode;
            statusMode.innerText = '[' + displayMode + ']';
            statusMode.className = 'badge-pill ' + (displayMode === "SAFE" ? "mode-plan" : (displayMode === "SEMI-AUTO" ? "mode-intermediate" : "mode-execute"));
        }

        window.__confirmFullAutoMode = () => {
            updateStatusBar({ mode: "EXECUTE", agent: activeAgentName, cwd: document.getElementById('tray-cwd-label')?.innerText });
            sendToPython({ action: "set_mode", mode: "EXECUTE" });
        };

        window.__rejectFullAutoMode = () => {
            updateStatusBar({ mode: "INTERMEDIATE", agent: activeAgentName, cwd: document.getElementById('tray-cwd-label')?.innerText });
            sendToPython({ action: "set_mode", mode: "INTERMEDIATE" });
        };

        function hideWelcomeHero() {
            const hero = document.getElementById('welcome-hero');
            if (hero) hero.style.display = 'none';
        }

        function getAgentColor(name) {
            const found = cachedAgents.find(a => a.name.toLowerCase() === (name || "").toLowerCase());
            return found ? found.color : "var(--brand-teal)";
        }

        function appendLog(text, isMarkdown) {
            const div = document.createElement('div');
            div.style.color = 'var(--text-dim)';
            div.style.fontSize = '0.8rem';
            div.style.margin = '0.3rem 0';
            const clean = stripRichTags(text);
            div.innerHTML = isMarkdown ? renderMarkdownText(clean) : window.electronAPI.escapeHtml(clean).replace(/\\n/g, '<br>');
            chatContainer.appendChild(div);
            applyLatexPass(div);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        let lastOptimisticText = "";
        let lastOptimisticTime = 0;

        function appendMessageBlock(header, content, color, isMarkdown, silent = false) {
            hideWelcomeHero();
            const cleanHead = stripRichTags(header);
            const cleanBody = stripRichTags(content);
            
            // Extract raw sender name securely
            const isToolCall = cleanHead.toLowerCase().includes("tool call");
            const senderName = cleanHead.replace(/:\s*$/, '').replace(/\(to .*\):?\s*$/, '').replace(/\(tool call\)/i, '').trim();
            
            // Accurately classify user vs any current or historical AI agent
            const isExplicitUser = (
                senderName.toLowerCase() === (cachedUserName || "user").toLowerCase() ||
                senderName.toLowerCase() === "user" ||
                senderName.toLowerCase().startsWith("telegram")
            );
            const isAI = isToolCall || (!isExplicitUser && senderName.toLowerCase() !== "system");
            const isUser = isExplicitUser;

            if (!silent && !window._isReplayingHistory) {
                if (isToolCall) {
                    soundFX.toolCall();
                } else if (isAI) {
                    soundFX.agentChime();
                }
            }

            // If the server echoes back the user prompt that was already rendered optimistically on submit, skip it
            if (isUser && lastOptimisticText && (Date.now() - lastOptimisticTime < 15000)) {
                if (cleanBody.trim() === lastOptimisticText || cleanBody.includes(lastOptimisticText)) {
                    lastOptimisticText = "";
                    return;
                }
            }

            const block = document.createElement('div');
            block.className = 'message-block ai-block';

            let agentAccent = color || getAgentColor(senderName);
            block.style.setProperty('--agent-accent', agentAccent);

            const card = document.createElement('div');
            card.className = 'ai-bubble-card' + (isToolCall ? ' tool-call-card' : '');
            card.dataset.sender = senderName;
            card.dataset.isToolCall = isToolCall ? "true" : "false";
            
            // Force border-radius via inline style with !important to guarantee CSS application
            if (isToolCall) {
                card.style.cssText = 'border-radius: 18px !important;';
            } else if (isUser) {
                card.style.cssText = 'border-radius: 18px 18px 4px 18px !important;';
            } else {
                card.style.cssText = 'border-radius: 18px 18px 18px 4px !important;';
            }

            const head = document.createElement('div');
            head.className = 'message-header';
            head.style.color = agentAccent;
            head.innerHTML = '<span>✦</span> <span>' + window.electronAPI.escapeHtml(cleanHead) + '</span>';

            const body = document.createElement('div');
            body.className = 'message-body';
            
            let images = [];
            let processedBody = cleanBody.replace(/\\\[ImageBase64:\\s*(data:image\\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+)\\\]/g, (match, b64) => {
                images.push(b64);
                return '';
            });

            body.innerHTML = isMarkdown ? renderMarkdownText(processedBody) : '<pre>' + window.electronAPI.escapeHtml(processedBody) + '</pre>';

            images.forEach(b64 => {
                const img = document.createElement('img');
                img.src = b64;
                img.style.maxWidth = '100%';
                img.style.height = 'auto';
                img.style.borderRadius = '8px';
                img.style.marginTop = '12px';
                img.style.display = 'block';
                body.appendChild(img);
            });

            card.appendChild(head);
            card.appendChild(body);
            block.appendChild(card);

            chatContainer.appendChild(block);
            applyLatexPass(block);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            activeAIMessageBlock = null;
            activeAIMessageBody = null;
        }

        // --- DEEP RESEARCH SWARM DASHBOARD ENGINE ---
        function formatSwarmLogLine(rawMsg) {
            var clean = stripRichTags(String(rawMsg || ''));
            clean = window.electronAPI.escapeHtml(clean);
            // Double-escape backslashes because this is inside a JS template literal in App.js
            clean = clean.replace(/\\[SEARCH\\]/g, '<span style="color: var(--brand-teal); font-weight: 700;">[SEARCH]</span>');
            clean = clean.replace(/\\[FETCH\\]/g, '<span style="color: var(--brand-yellow); font-weight: 700;">[FETCH]</span>');
            clean = clean.replace(/\\[TARGET REACHED\\]/g, '<span style="color: var(--brand-green); font-weight: 700;">[TARGET REACHED]</span>');
            clean = clean.replace(/\\[PIVOT\\]/g, '<span style="color: var(--brand-orange); font-weight: 700;">[PIVOT]</span>');
            clean = clean.replace(/\\[RECOVERY\\]/g, '<span style="color: var(--brand-red); font-weight: 700;">[RECOVERY]</span>');
            clean = clean.replace(/\\[ENFORCER\\]/g, '<span style="color: var(--brand-red); font-weight: 700;">[ENFORCER]</span>');
            clean = clean.replace(/\\[SWARM INIT\\]/g, '<span style="color: var(--brand-teal); font-weight: 700;">[SWARM INIT]</span>');
            clean = clean.replace(/\\[POST-PROCESS\\]/g, '<span style="color: var(--brand-green); font-weight: 700;">[POST-PROCESS]</span>');
            clean = clean.replace(/\\[MASTER ORCHESTRATOR\\]/g, '<span style="color: var(--brand-green); font-weight: 700;">[MASTER ORCHESTRATOR]</span>');
            clean = clean.replace(/(\\[\\d+\\/\\d+\\])/g, '<span style="color: var(--brand-yellow); font-weight: 700;">$1</span>');
            clean = clean.replace(/\\b(ANNEXURE [A-Z])\\b/g, '<span style="color: var(--brand-teal); font-weight: 700;">$1</span>');
            return clean;
        }

        function mountProgress(tasks) {
            hideWelcomeHero();

            let hud = document.getElementById('research-swarm-hud');
            if (!hud) {
                hud = document.createElement('div');
                hud.id = 'research-swarm-hud';
            }

            let tasksHtml = '';
            (tasks || []).forEach(function(t) {
                const safeId = 'task_' + String(t || '').replace(/[^a-zA-Z0-9]/g, '_');

                tasksHtml += '<div class="swarm-task-card active" id="card-' + safeId + '">' +
                    '<div class="swarm-task-header">' +
                        '<div class="swarm-task-left">' +
                            '<div class="swarm-spinner" id="spin-' + safeId + '"></div>' +
                            '<span class="swarm-task-name">' + window.electronAPI.escapeHtml(t) + '</span>' +
                        '</div>' +
                        '<span class="swarm-task-pct" id="pct-' + safeId + '">0%</span>' +
                    '</div>' +
                    '<div class="swarm-progress-track">' +
                        '<div class="swarm-progress-fill" id="fill-' + safeId + '" style="width: 0%;"></div>' +
                    '</div>' +
                '</div>';
            });

            const taskCount = tasks ? tasks.length : 0;
            hud.innerHTML = '<div class="swarm-header">' +
                '<div class="swarm-title">' +
                    '<span>🛸</span>' +
                    '<span>DEEP RESEARCH SWARM</span>' +
                '</div>' +
            '</div>' +
            '<div class="swarm-body">' +
                '<div class="swarm-tasks-list">' + tasksHtml + '</div>' +
                '<div class="swarm-log-header">' +
                    '<span>📟 LIVE SWARM TELEMETRY STREAM</span>' +
                    '<span style="color: var(--brand-green); font-size: 0.68rem;">● Live</span>' +
                '</div>' +
                '<div class="swarm-log-container" id="swarm-log-feed">' +
                    '<div class="swarm-log-line" style="color: var(--brand-teal);">[SWARM INIT] Master Orchestrator deployed ' + taskCount + ' parallel research agents...</div>' +
                '</div>' +
            '</div>';

            hud.style.display = 'flex';
            hud.style.flexShrink = '0';
            chatContainer.appendChild(hud);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        function updateProgress(task, percent, logMsg) {
            const safeId = 'task_' + String(task || '').replace(/[^a-zA-Z0-9]/g, '_');

            const fillEl = document.getElementById('fill-' + safeId);
            const pctEl = document.getElementById('pct-' + safeId);
            const cardEl = document.getElementById('card-' + safeId);
            const spinEl = document.getElementById('spin-' + safeId);

            if (percent !== null && percent !== undefined) {
                // Keep bar completely empty at 0% on spawn until research token milestones accumulate
                const rawPct = (percent <= 5) ? 0 : percent;
                const cleanPct = Math.min(Math.max(Math.round(rawPct), 0), 100);
                if (fillEl) fillEl.style.width = cleanPct + '%';
                if (pctEl) {
                    pctEl.innerText = cleanPct >= 100 ? '✓ Done' : (cleanPct + '%');
                    if (cleanPct >= 100) pctEl.style.color = 'var(--brand-green)';
                }
                if (cleanPct >= 100) {
                    if (spinEl) {
                        spinEl.className = 'swarm-spinner done';
                        spinEl.innerText = '✓';
                    }
                    if (cardEl) {
                        cardEl.classList.remove('active');
                        cardEl.classList.add('completed');
                    }
                }
            }

            if (logMsg) {
                const feed = document.getElementById('swarm-log-feed');
                if (feed) {
                    const line = document.createElement('div');
                    line.className = 'swarm-log-line';
                    line.innerHTML = formatSwarmLogLine(logMsg);
                    feed.appendChild(line);
                    feed.scrollTop = feed.scrollHeight;
                }
            }
        }

        function hideProgress() {
            const hud = document.getElementById('research-swarm-hud');
            if (hud) {
                const feed = document.getElementById('swarm-log-feed');
                if (feed) {
                    const line = document.createElement('div');
                    line.className = 'swarm-log-line';
                    line.style.color = 'var(--brand-green)';
                    line.style.fontWeight = 'bold';
                    line.innerHTML = '✨ [MASTER ORCHESTRATOR] All annexures gathered. Generating master report & rendering PDF...';
                    feed.appendChild(line);
                    feed.scrollTop = feed.scrollHeight;
                }
            }
        }

        function mountAIBox(agentName, color) {
            hideWelcomeHero();
            soundFX.agentChime();
            const agentAccent = color || getAgentColor(agentName);

            const block = document.createElement('div');
            block.className = 'message-block ai-block';
            block.style.setProperty('--agent-accent', agentAccent);

            const card = document.createElement('div');
            card.className = 'ai-bubble-card';

            const head = document.createElement('div');
            head.className = 'message-header';
            head.innerHTML = '<span>✦</span> <span>' + window.electronAPI.escapeHtml(agentName) + '</span>';

            activeAIMessageBody = document.createElement('div');
            activeAIMessageBody.className = 'message-body';

            card.appendChild(head);
            card.appendChild(activeAIMessageBody);
            block.appendChild(card);

            chatContainer.appendChild(block);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            activeAIMessageBlock = block;
        }

        function updateAIBox(content) {
            if (!activeAIMessageBody) {
                mountAIBox(activeAgentName || "Agent", getAgentColor(activeAgentName));
            }
            if (activeAIMessageBody) {
                let images = [];
                let cleanContent = (content || "").replace(/\\\[ImageBase64:\\s*(data:image\\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+)\\\]/g, (match, b64) => {
                    images.push(b64);
                    return '';
                });
                
                activeAIMessageBody.innerHTML = renderMarkdownText(stripRichTags(cleanContent));
                
                images.forEach(b64 => {
                    const img = document.createElement('img');
                    img.src = b64;
                    img.style.maxWidth = '100%';
                    img.style.height = 'auto';
                    img.style.borderRadius = '8px';
                    img.style.marginTop = '12px';
                    img.style.display = 'block';
                    activeAIMessageBody.appendChild(img);
                });
                
                applyLatexPass(activeAIMessageBody);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }

        function appendToolResult(type, agent, color, summary, isError = false, silent = false) {
            hideWelcomeHero();
            if (!silent && !window._isReplayingHistory) {
                soundFX.toolResult();
            }
            const accent = isError ? "var(--brand-red)" : (color || getAgentColor(agent));

            const block = document.createElement('div');
            block.className = 'message-block ai-block';
            block.style.setProperty('--agent-accent', accent);

            const card = document.createElement('div');
            card.className = 'tool-result-box';

            const head = document.createElement('div');
            head.className = 'message-header';
            head.innerHTML = '<span>✦</span> <span>' + window.electronAPI.escapeHtml(type + ' (' + agent + ')') + '</span>';

            const body = document.createElement('div');
            body.className = 'message-body';

            let images = [];
            let rawText = stripRichTags(summary).replace(/\\\[ImageBase64:\\s*(data:image\\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+)\\\]/g, (match, b64) => {
                images.push(b64);
                return '';
            }).trim();
            const nl = String.fromCharCode(10);
            const lines = rawText.split(nl);

            if (lines.length > 6) {
                const first3 = lines.slice(0, 3).join(nl);
                const last3 = lines.slice(-3).join(nl);
                const collapsedHtml = window.electronAPI.escapeHtml(first3) + nl + nl + '<b><i>Shortened for brevity, tap to toggle.</i></b>' + nl + nl + window.electronAPI.escapeHtml(last3);
                const fullHtml = window.electronAPI.escapeHtml(rawText);
                let isExpanded = false;
                body.innerHTML = collapsedHtml;
                card.style.cursor = 'pointer';
                card.onclick = function() {
                    isExpanded = !isExpanded;
                    body.innerHTML = isExpanded ? fullHtml : collapsedHtml;
                };
            } else {
                body.innerText = rawText;
            }

            card.appendChild(head);

            images.forEach(b64 => {
                const img = document.createElement('img');
                img.src = b64;
                img.style.maxWidth = '100%';
                img.style.height = 'auto';
                img.style.borderRadius = '8px';
                img.style.marginTop = '6px';
                img.style.marginBottom = '8px';
                img.style.display = 'block';
                card.appendChild(img);
            });

            card.appendChild(body);
            block.appendChild(card);

            chatContainer.appendChild(block);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        // Suggestions
        function renderSuggestions(msg) {
            currentSuggestions = msg.matches || [];
            currentPrefix = msg.prefix || "";
            selectedSuggestionIdx = currentSuggestions.length > 0 ? 0 : -1;

            if (currentSuggestions.length === 0) {
                suggestionsPopup.style.display = 'none';
                return;
            }

            suggestionsPopup.innerHTML = '';
            currentSuggestions.forEach((item, idx) => {
                const row = document.createElement('div');
                row.className = 'suggestion-item ' + (idx === 0 ? 'selected' : '');
                row.innerHTML = '<span>' + window.electronAPI.escapeHtml(item.match) + '</span><span style="color:var(--text-dim); font-size:0.75rem;">' + window.electronAPI.escapeHtml(item.desc) + '</span>';
                row.onclick = () => applySuggestion(item.match);
                suggestionsPopup.appendChild(row);
            });
            suggestionsPopup.style.display = 'block';
        }

        function applySuggestion(matchText) {
            chatInput.value = currentPrefix + matchText;
            suggestionsPopup.style.display = 'none';
            currentSuggestions = [];
            adjustTextareaHeight();
            chatInput.focus();
        }

        chatInput.addEventListener('input', () => {
            adjustTextareaHeight();
            sendToPython({ action: "get_suggestions", value: chatInput.value });
        });

        chatInput.addEventListener('focus', () => {
            updateViewportHeight();
            setTimeout(() => {
                updateViewportHeight();
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 80);
        });

        // --- ATTACHMENT SYSTEM ---
        let pendingAttachments = [];

        const filePickerInput = document.getElementById('file-picker-input');
        const pendingAttachmentsBar = document.getElementById('pending-attachments-bar');

        function sanitizeAttachmentName(originalName, defaultExt) {
            defaultExt = defaultExt || '.jpg';
            let name = originalName || 'file';
            let clean = name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const timestamp = Date.now();
            const dotIdx = clean.lastIndexOf('.');
            if (dotIdx !== -1 && dotIdx < clean.length - 1) {
                const baseName = clean.substring(0, dotIdx);
                const ext = clean.substring(dotIdx);
                return baseName + '_' + timestamp + ext;
            }
            return clean + '_' + timestamp + defaultExt;
        }

        function handleSelectedFiles(files) {
            if (!files || files.length === 0) return;
            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    let fallbackExt = '.jpg';
                    if (file.type) {
                        const sub = file.type.split('/')[1];
                        if (sub) fallbackExt = '.' + sub.replace(/[^a-zA-Z0-9]/g, '');
                    }
                    const savedName = sanitizeAttachmentName(file.name, fallbackExt);
                    pendingAttachments.push({
                        name: savedName,
                        data: e.target.result
                    });
                    renderPendingAttachments();
                };
                reader.readAsDataURL(file);
            });
        }

        filePickerInput.onchange = (e) => {
            handleSelectedFiles(e.target.files);
            e.target.value = '';
        };

        window.removeAttachment = function(idx) {
            pendingAttachments.splice(idx, 1);
            renderPendingAttachments();
        };

        window.handleIncomingSharedFile = function(filename) {
            const inputEl = document.getElementById('chat-input');
            if (inputEl) {
                const tag = '&' + filename;
                if (!inputEl.value.includes(tag)) {
                    const currentVal = inputEl.value.trim();
                    inputEl.value = currentVal ? currentVal + ' ' + tag + ' ' : tag + ' ';
                    adjustTextareaHeight();
                    inputEl.focus();
                }
            }
            if (document.getElementById('workspace-modal').style.display === 'flex') {
                openWorkspaceModal(currentWorkspaceRelPath);
            }
        };

        function renderPendingAttachments() {
            if (pendingAttachments.length === 0) {
                pendingAttachmentsBar.style.display = 'none';
                pendingAttachmentsBar.innerHTML = '';
                return;
            }
            pendingAttachmentsBar.innerHTML = '';
            pendingAttachmentsBar.style.display = 'flex';
            pendingAttachments.forEach((att, idx) => {
                const chip = document.createElement('div');
                chip.className = 'attachment-chip';
                
                // Strict Regex Guardrail: Double-escaped backslash for React Native template literal
                const isImg = att.data && /^data:image\\/[a-zA-Z0-9+.-]+;base64,/.test(att.data);
                
                const preview = isImg 
                    ? '<img src="' + window.electronAPI.escapeHtml(att.data) + '" style="height:16px;width:16px;border-radius:3px;object-fit:cover;vertical-align:middle;margin-right:4px;">' 
                    : '📎 ';
                    
                chip.innerHTML = '<span>' + preview + window.electronAPI.escapeHtml(att.name) + '</span><button type="button" onclick="removeAttachment(' + idx + ')">×</button>';
                pendingAttachmentsBar.appendChild(chip);
            });
        }

        function submitPrompt() {
            const text = chatInput.value.trim();
            if (!text && pendingAttachments.length === 0) return;
        
            soundFX.send();

            // 1. Send each attached file to Python to write directly to FederateWorkspace
            pendingAttachments.forEach(att => {
                sendToPython({
                    action: "save_attachment",
                    filename: att.name,
                    data: att.data
                });
            });

            // 2. Append &filename internally into the prompt payload
            let fullText = text;
            if (pendingAttachments.length > 0) {
                const attachmentTags = pendingAttachments.map(a => '&' + a.name).join(' ');
                fullText = (fullText ? fullText + ' ' : '') + attachmentTags;
            }

            // 3. Optimistically render user message INSTANTLY on UI using the exact original bubble card format
            const uName = cachedUserName || "User";
            const uColor = cachedUserColor || "#dda0dd";
            appendMessageBlock(uName + ":", fullText, uColor, true);

            // 3.5 Safely append image previews directly to the DOM to bypass Markdown parser crash
            if (pendingAttachments.length > 0) {
                const msgBodies = document.querySelectorAll('.message-body');
                if (msgBodies.length > 0) {
                    const lastBody = msgBodies[msgBodies.length - 1];
                    pendingAttachments.forEach(a => {
                        if (a.data && a.data.startsWith('data:image/')) {
                            const img = document.createElement('img');
                            img.src = a.data;
                            img.style.maxWidth = '100%';
                            img.style.height = 'auto';
                            img.style.borderRadius = '8px';
                            img.style.marginTop = '12px';
                            img.style.display = 'block';
                            lastBody.appendChild(img);
                        }
                    });
                    const chatCont = document.getElementById('chat-container');
                    if (chatCont) chatCont.scrollTop = chatCont.scrollHeight;
                }
            }

            // Save deduplication token after the bubble is mounted
            lastOptimisticText = fullText.trim();
            lastOptimisticTime = Date.now();

            // 4. Dispatch input to backend (spinner will be triggered when the server responds)
            sendToPython({ action: "input", text: fullText });

            // 5. Reset entry inputs
            chatInput.value = '';
            chatInput.style.height = 'auto';
            suggestionsPopup.style.display = 'none';
            pendingAttachments = [];
            renderPendingAttachments();
            chatInput.focus();
        }

        document.getElementById('btn-send').onclick = submitPrompt;

        let modeLongPressTimer = null;
        let modeLongPressTriggered = false;

        function resetToSafeMode() {
            if (currentAgentMode !== "PLAN") {
                updateStatusBar({ mode: "PLAN", agent: activeAgentName, cwd: document.getElementById('tray-cwd-label')?.innerText });
                sendToPython({ action: "set_mode", mode: "PLAN" });
                if (navigator.vibrate) navigator.vibrate([30, 50]);
            }
        }

        function startModeLongPress() {
            modeLongPressTriggered = false;
            if (modeLongPressTimer) clearTimeout(modeLongPressTimer);
            modeLongPressTimer = setTimeout(function() {
                modeLongPressTriggered = true;
                resetToSafeMode();
            }, 500);
        }

        function cancelModeLongPress() {
            if (modeLongPressTimer) {
                clearTimeout(modeLongPressTimer);
                modeLongPressTimer = null;
            }
        }

        statusMode.addEventListener('touchstart', startModeLongPress, { passive: true });
        statusMode.addEventListener('touchend', cancelModeLongPress);
        statusMode.addEventListener('touchcancel', cancelModeLongPress);
        statusMode.addEventListener('mousedown', startModeLongPress);
        statusMode.addEventListener('mouseup', cancelModeLongPress);
        statusMode.addEventListener('mouseleave', cancelModeLongPress);

        statusMode.onclick = function() {
            if (modeLongPressTriggered) {
                modeLongPressTriggered = false;
                return;
            }
            if (currentAgentMode === "PLAN") {
                // Step 1: SAFE -> SEMI-AUTO (No biometrics required)
                updateStatusBar({ mode: "INTERMEDIATE", agent: activeAgentName, cwd: document.getElementById('tray-cwd-label')?.innerText });
                sendToPython({ action: "set_mode", mode: "INTERMEDIATE" });
            } else if (currentAgentMode === "INTERMEDIATE") {
                // Step 2: SEMI-AUTO -> FULL-AUTO (Biometrics strictly required!)
                if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "_request_full_auto_auth" }));
                }
            } else {
                // Step 3: FULL-AUTO -> SAFE (Drop permissions immediately, no biometrics required)
                resetToSafeMode();
            }
        };

        let lastAgentData = null;
        let lastAllTools = [];
        let lastAllAgentNames = [];
        let lastGlobalSettings = {
            user_name: "User",
            user_color: "#dda0dd",
            search_pacing_delay: 65.0,
            max_search_results: 10,
            scraper_max_bytes: 1000000,
            scraper_timeout: 120.0,
            scraper_max_tokens: 30000,
            autoupdate_on_launch: false,
            max_api_retries: 20,
            api_retry_delay: 15.0,
            quota_retry_delay: 120.0,
            max_research_agents: 4,
            research_context_tokens: 28000,
            research_min_length: 5000,
            max_shrink_attempts: 15,
            pdf_dpi: 150,
            pdf_footer_text: "FEDERATE RESEARCH REPORT",
            research_image_system_enabled: false,
            research_images_max: 10,
            research_image_retries: 1,
            research_images_as_links: false,
            tool_result_visibility: "private",
            keep_verbatim_count: 2
        };

        function openGlobalSettings() {
            sendToPython({ action: "get_global_settings" });
            populateGlobalSettingsModal(lastGlobalSettings);
            document.getElementById('global-settings-modal').style.display = 'flex';
        }

        function openAgentConfig(targetName) {
            const agentNameToFetch = targetName || activeAgentName;
            sendToPython({ action: "get_agent_data", name: agentNameToFetch });
            // Pre-populate from cache immediately so the modal never appears blank
            if (lastAgentData && (!targetName || lastAgentData.name === targetName)) {
                populateAgentModal(lastAgentData, lastAllTools, lastAllAgentNames);
            } else {
                const agentObj = cachedAgents.find(a => a.name === agentNameToFetch) || { name: agentNameToFetch };
                populateAgentModal(agentObj, lastAllTools, lastAllAgentNames);
            }
            document.getElementById('agent-config-modal').style.display = 'flex';
        }

        let currentlyEditingTaskId = null;
        let lastLoadedSchedules = [];

        function resetScheduleForm() {
            currentlyEditingTaskId = null;
            const timeEl = document.getElementById('sched-time-input');
            const dateEl = document.getElementById('sched-date-input');
            const promptEl = document.getElementById('sched-prompt-input');
            const btnEl = document.getElementById('btn-create-schedule');
            if (timeEl) timeEl.value = '';
            if (dateEl) dateEl.value = '';
            if (promptEl) promptEl.value = '';
            if (btnEl) btnEl.innerText = '+ Add Task Routine';
        }

        function renderSchedulesList(tasks) {
            lastLoadedSchedules = tasks || [];
            const listEl = document.getElementById('sched-list');
            if (!listEl) return;
            listEl.innerHTML = '';

            const visibleTasks = lastLoadedSchedules.filter(t => t.id !== currentlyEditingTaskId);

            if (!visibleTasks || visibleTasks.length === 0) {
                listEl.innerHTML = '<div style="color: var(--text-dim); font-size: 0.8rem; padding: 6px 0;">' +
                    (currentlyEditingTaskId ? 'Editing staged task above...' : 'No active scheduled routines.') +
                    '</div>';
                return;
            }

            visibleTasks.forEach(t => {
                const row = document.createElement('div');
                row.style.cssText = 'background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px; cursor: pointer; transition: all 0.2s ease;';

                const info = document.createElement('div');
                info.style.cssText = 'flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 2px;';

                const headerLine = document.createElement('div');
                headerLine.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 0.78rem; font-weight: 700; font-family: var(--font-mono);';
                const agentCol = getAgentColor(t.agent_name);
                const repeatCap = (t.repeat || 'daily').charAt(0).toUpperCase() + (t.repeat || 'daily').slice(1);
                headerLine.innerHTML = '<span style="color:' + agentCol + ';">@' + window.electronAPI.escapeHtml(t.agent_name) + '</span>' +
                    '<span style="color: var(--brand-yellow);">⏰ ' + window.electronAPI.escapeHtml(t.time_str) + '</span>' +
                    '<span style="color: var(--text-dim); font-size: 0.72rem;">[' + repeatCap + (t.date_str ? ' • ' + window.electronAPI.escapeHtml(t.date_str) : '') + ']</span>' +
                    '<span style="font-size: 0.7rem; color: var(--brand-teal); margin-left: auto;">✏️ Edit</span>';

                const promptLine = document.createElement('div');
                promptLine.style.cssText = 'color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
                promptLine.innerText = t.prompt;

                info.appendChild(headerLine);
                info.appendChild(promptLine);

                // Tapping task row populates form and pops it from visible list
                row.onclick = (e) => {
                    if (e.target.closest('.sched-del-btn')) return;
                    currentlyEditingTaskId = t.id;

                    const agentSelect = document.getElementById('sched-agent-select');
                    const timeInput = document.getElementById('sched-time-input');
                    const dateInput = document.getElementById('sched-date-input');
                    const repeatSelect = document.getElementById('sched-repeat-select');
                    const promptInput = document.getElementById('sched-prompt-input');
                    const btn = document.getElementById('btn-create-schedule');

                    if (agentSelect) agentSelect.value = t.agent_name;
                    if (timeInput) timeInput.value = t.time_str || '';
                    if (dateInput) dateInput.value = t.date_str || '';
                    if (repeatSelect) repeatSelect.value = t.repeat || 'daily';
                    if (promptInput) promptInput.value = t.prompt || '';
                    if (btn) btn.innerText = '✓ Save Changes to Task';

                    renderSchedulesList(lastLoadedSchedules);
                    if (promptInput) promptInput.focus();
                };

                const delBtn = document.createElement('button');
                delBtn.className = 'modal-btn btn-secondary sched-del-btn';
                delBtn.style.cssText = 'padding: 3px 6px; font-size: 0.72rem; color: var(--brand-red); flex-shrink: 0;';
                delBtn.innerText = '🗑️';
                delBtn.title = 'Delete schedule';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (currentlyEditingTaskId === t.id) resetScheduleForm();
                    sendToPython({ action: "delete_schedule", id: t.id });
                };

                row.appendChild(info);
                row.appendChild(delBtn);
                listEl.appendChild(row);
            });
        }

        function openSchedulesModal() {
            resetScheduleForm();
            const select = document.getElementById('sched-agent-select');
            select.innerHTML = '';
            cachedAgents.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a.name;
                opt.innerText = a.name;
                select.appendChild(opt);
            });
            sendToPython({ action: "get_schedules" });
            document.getElementById('schedule-modal').style.display = 'flex';
        }

        document.getElementById('btn-create-schedule').onclick = () => {
            const agent = document.getElementById('sched-agent-select').value;
            const time_str = document.getElementById('sched-time-input').value.trim();
            const date_str = document.getElementById('sched-date-input').value.trim();
            const repeat = document.getElementById('sched-repeat-select').value;
            const prompt_text = document.getElementById('sched-prompt-input').value.trim();

            if (!time_str || !prompt_text) {
                alert("Please provide both a scheduled time and a task prompt.");
                return;
            }

            // If editing, delete original task from backend only now that user is committing changes
            if (currentlyEditingTaskId) {
                sendToPython({ action: "delete_schedule", id: currentlyEditingTaskId });
            }

            const scheduleCommand = '/schedule ' + agent + ' ' + time_str + (date_str ? ' ' + date_str : '') + ' ' + repeat + ' ' + prompt_text;
            sendToPython({ action: "input", text: scheduleCommand });

            resetScheduleForm();
            setTimeout(() => {
                sendToPython({ action: "get_schedules" });
            }, 200);
        };

        function updateAuthButtonVisibility(presetValue) {
            const authBtn = document.getElementById('btn-chatgpt-auth');
            const apiKeyInput = document.getElementById('cfg-agent-api-key');
            const apiKeyLabel = document.getElementById('cfg-agent-api-key-label');
            const statusEl = document.getElementById('chatgpt-auth-status');
            if (presetValue === "https://chatgpt.com/backend-api/codex") {
                authBtn.style.display = "block";
                apiKeyInput.style.display = "none";
                apiKeyLabel.style.display = "none";
                if (statusEl) statusEl.style.display = "block";
            } else {
                authBtn.style.display = "none";
                apiKeyInput.style.display = "block";
                apiKeyLabel.style.display = "block";
                if (statusEl) {
                    statusEl.style.display = "none";
                    statusEl.innerHTML = '';
                }
            }
        }

        document.getElementById('cfg-agent-base-preset').addEventListener('change', (e) => {
            if (e.target.value !== 'custom') {
                document.getElementById('cfg-agent-base-url').value = e.target.value;
            }
            updateAuthButtonVisibility(e.target.value);
        });

        document.getElementById('btn-chatgpt-auth').onclick = () => {
            const authBtn = document.getElementById('btn-chatgpt-auth');
            const statusEl = document.getElementById('chatgpt-auth-status');
            authBtn.disabled = true;
            authBtn.innerText = '⏳ Waiting for browser sign-in...';
            if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-teal);">Please complete sign-in in your browser...</span>';
            sendToPython({ action: "start_chatgpt_oauth" });
        };

        function syncColorPicker(pickerId, textId, defaultColor = "#3ddbd9") {
            const picker = document.getElementById(pickerId);
            const text = document.getElementById(textId);
            if (!picker || !text) return;

            if (!picker._hasSyncListener) {
                picker.addEventListener('input', () => { text.value = picker.value; });
                text.addEventListener('input', () => {
                    let val = text.value.trim();
                    if (/^#[0-9A-Fa-f]{6}$/.test(val)) picker.value = val;
                });
                picker._hasSyncListener = true;
            }

            let currentVal = text.value.trim() || defaultColor;
            if (/^#[0-9A-Fa-f]{6}$/.test(currentVal)) {
                picker.value = currentVal;
            }
        }

        function populateAgentModal(agent, allTools, allAgentNames) {
            if (!agent) return;
            lastAgentData = agent;
            if (allTools && allTools.length > 0) lastAllTools = allTools;
            if (allAgentNames && allAgentNames.length > 0) lastAllAgentNames = allAgentNames;

            // Merge all known agent names into cachedAgents
            if (allAgentNames && allAgentNames.length > 0) {
                allAgentNames.forEach(name => {
                    if (!cachedAgents.some(a => a.name.toLowerCase() === name.toLowerCase())) {
                        cachedAgents.push({ name: name, color: "var(--brand-teal)", model: "" });
                    }
                });
            }

            const agentColor = agent.color || "#3ddbd9";
            document.getElementById('cfg-agent-name').value = agent.name || "";
            document.getElementById('cfg-agent-color').value = agentColor;
            syncColorPicker('cfg-agent-color-picker', 'cfg-agent-color', agentColor);
            document.getElementById('cfg-agent-backstory').value = agent.backstory || "";
            document.getElementById('cfg-agent-model').value = agent.model || "";
            document.getElementById('cfg-agent-reasoning').value = agent.reasoning_effort || "none";
            document.getElementById('cfg-agent-temp').value = agent.temperature !== undefined ? agent.temperature : 1.0;

            const bUrl = agent.base_url || "https://openrouter.ai/api/v1";
            document.getElementById('cfg-agent-base-url').value = bUrl;

            const presetSelect = document.getElementById('cfg-agent-base-preset');
            let matched = "custom";
            for (let opt of presetSelect.options) {
                if (opt.value === bUrl) {
                    matched = bUrl;
                    break;
                }
            }
            presetSelect.value = matched;
            updateAuthButtonVisibility(matched);

            document.getElementById('cfg-agent-api-key').value = agent.api_key || "";
            
            const voiceSelect = document.getElementById('cfg-agent-voice');
            const targetVoice = agent.tts_voice || "af_sarah";
            let voiceFound = false;
            for (let opt of voiceSelect.options) {
                if (opt.value === targetVoice) { voiceFound = true; break; }
            }
            if (!voiceFound && targetVoice) {
                const opt = document.createElement('option');
                opt.value = targetVoice;
                opt.innerText = targetVoice + " (Custom)";
                voiceSelect.appendChild(opt);
            }
            voiceSelect.value = targetVoice;

            document.getElementById('cfg-agent-pronouns').value = agent.pronouns || "she/her";
            document.getElementById('cfg-agent-vision').checked = !!agent.is_capable_vision;
            document.getElementById('cfg-agent-disable-all').checked = !!agent.disable_all_tools;

            document.getElementById('cfg-agent-use-backup').checked = !!agent.use_backup;
            document.getElementById('cfg-agent-backup-model').value = agent.backup_model || "";
            document.getElementById('cfg-agent-backup-base').value = agent.backup_base_url || "";
            document.getElementById('cfg-agent-backup-key').value = agent.backup_api_key || "";

            const copySelect = document.getElementById('cfg-copy-from-agent');
            copySelect.innerHTML = '<option value="">Manual Entry</option>';
            const namesToUse = (allAgentNames && allAgentNames.length > 0) ? allAgentNames : cachedAgents.map(a => a.name);
            namesToUse.forEach(name => {
                if (name !== agent.name) {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.innerText = name;
                    copySelect.appendChild(opt);
                }
            });

            copySelect.onchange = (e) => {
                if (!e.target.value) return;
                const target = cachedAgents.find(a => a.name === e.target.value);
                if (target) {
                    document.getElementById('cfg-agent-backup-model').value = target.model || "";
                    document.getElementById('cfg-agent-backup-base').value = target.base_url || "";
                }
            };

            const tbody = document.getElementById('abilities-table-body');
            tbody.innerHTML = '';
            const enabled = agent.enabled_tools || [];
            const disabled = agent.disabled_tools || [];
            const toolsList = (allTools && allTools.length > 0) ? allTools : [
                "list_files", "search_web", "perform_research", "render_pdf", "manage_agenda",
                "read_file", "fetch_url", "save_file", "edit_file",
                "dispatch_coding_subagent", "run_terminal_command", "visual_computer_operation", "send_file_to_telegram"
            ];

            toolsList.forEach(t => {
                const row = document.createElement('tr');
                const isEn = enabled.includes(t);
                const isDis = disabled.includes(t);
                const escapedTool = window.electronAPI.escapeHtml(t);
                row.innerHTML = '<td>' + escapedTool + '</td>' +
                    '<td><input type="checkbox" class="tool-enable-cb" data-tool="' + escapedTool + '" ' + (isEn ? 'checked' : '') + '></td>' +
                    '<td><input type="checkbox" class="tool-disable-cb" data-tool="' + escapedTool + '" ' + (isDis ? 'checked' : '') + '></td>';
                tbody.appendChild(row);
            });
        }

        document.getElementById('btn-save-agent').onclick = () => saveAgent(false);
        document.getElementById('btn-save-as-new').onclick = () => saveAgent(true);
        document.getElementById('btn-delete-agent').onclick = () => {
            const name = document.getElementById('cfg-agent-name').value;
            sendToPython({ action: "delete_agent", name });
            closeModals();
        };

        function saveAgent(isNew) {
            const name = document.getElementById('cfg-agent-name').value.trim();
            const statusEl = document.getElementById('cfg-agent-status-msg');
            if (!name) {
                if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-red);">Agent name cannot be empty.</span>';
                return;
            }

            const enabled = [];
            document.querySelectorAll('.tool-enable-cb:checked').forEach(cb => enabled.push(cb.dataset.tool));
            const disabled = [];
            document.querySelectorAll('.tool-disable-cb:checked').forEach(cb => disabled.push(cb.dataset.tool));

            const saveBtn = document.getElementById('btn-save-agent');
            const saveNewBtn = document.getElementById('btn-save-as-new');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerText = 'Verifying...'; }
            if (saveNewBtn) { saveNewBtn.disabled = true; }
            if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-yellow);">⏳ Verifying model & translating backstory...</span>';

            const fields = {
                name: name,
                color: document.getElementById('cfg-agent-color').value.trim(),
                backstory: document.getElementById('cfg-agent-backstory').value.trim(),
                model: document.getElementById('cfg-agent-model').value.trim(),
                reasoning_effort: document.getElementById('cfg-agent-reasoning').value,
                temperature: parseFloat(document.getElementById('cfg-agent-temp').value) || 1.0,
                base_url: document.getElementById('cfg-agent-base-url').value.trim(),
                api_key: document.getElementById('cfg-agent-api-key').value.trim(),
                tts_voice: document.getElementById('cfg-agent-voice').value,
                pronouns: document.getElementById('cfg-agent-pronouns').value,
                is_capable_vision: document.getElementById('cfg-agent-vision').checked,
                disable_all_tools: document.getElementById('cfg-agent-disable-all').checked,
                use_backup: document.getElementById('cfg-agent-use-backup').checked,
                backup_model: document.getElementById('cfg-agent-backup-model').value.trim(),
                backup_base_url: document.getElementById('cfg-agent-backup-base').value.trim(),
                backup_api_key: document.getElementById('cfg-agent-backup-key').value.trim(),
                enabled_tools: enabled,
                disabled_tools: disabled
            };

            sendToPython({ 
                action: "save_agent_data", 
                fields, 
                is_new: isNew,
                old_name: (lastAgentData && lastAgentData.name) ? lastAgentData.name : name
            });
        }

        function populateGlobalSettingsModal(data) {
            if (!data) return;
            lastGlobalSettings = Object.assign({}, lastGlobalSettings, data);
            
            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el && val !== undefined && val !== null) el.value = val;
            };
            const setChecked = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.checked = !!val;
            };

            const userCol = data.user_color || "#dda0dd";
            setVal('cfg-user-name', data.user_name || "User");
            setVal('cfg-user-color', userCol);
            syncColorPicker('cfg-user-color-picker', 'cfg-user-color', userCol);
            setVal('cfg-search-delay', data.search_pacing_delay !== undefined ? data.search_pacing_delay : 65.0);
            setVal('cfg-max-search-results', data.max_search_results || 10);
            setVal('cfg-scraper-max-bytes', data.scraper_max_bytes || 1000000);
            setVal('cfg-scraper-timeout', data.scraper_timeout || 120.0);
            setVal('cfg-scraper-max-tokens', data.scraper_max_tokens || 30000);
            setChecked('cfg-autoupdate-on-launch', data.autoupdate_on_launch);
            setVal('cfg-max-api-retries', data.max_api_retries || 20);
            setVal('cfg-api-retry-delay', data.api_retry_delay || 15.0);
            setVal('cfg-quota-retry-delay', data.quota_retry_delay || 120.0);
            setVal('cfg-max-research-agents', data.max_research_agents || 4);
            setVal('cfg-research-context-tokens', data.research_context_tokens || 28000);
            setVal('cfg-research-min-length', data.research_min_length || 5000);
            setVal('cfg-max-shrink-attempts', data.max_shrink_attempts || 15);
            setVal('cfg-pdf-dpi', data.pdf_dpi || 150);
            setVal('cfg-pdf-footer-text', data.pdf_footer_text || "FEDERATE RESEARCH REPORT");
            setChecked('cfg-research-image-enabled', data.research_image_system_enabled);
            setVal('cfg-research-images-max', data.research_images_max || 10);
            setVal('cfg-research-image-retries', data.research_image_retries || 1);
            setChecked('cfg-research-images-links', !data.research_images_as_links);
            setVal('cfg-tool-vis', data.tool_result_visibility || "private");
            setVal('cfg-keep-verbatim-count', data.keep_verbatim_count !== undefined ? data.keep_verbatim_count : 2);
        }

        document.getElementById('btn-save-global').onclick = () => {
            const settings = {
                user_name: document.getElementById('cfg-user-name').value.trim(),
                user_color: document.getElementById('cfg-user-color').value.trim(),
                search_pacing_delay: parseFloat(document.getElementById('cfg-search-delay').value) || 65.0,
                max_search_results: parseInt(document.getElementById('cfg-max-search-results').value) || 10,
                scraper_max_bytes: parseInt(document.getElementById('cfg-scraper-max-bytes').value) || 1000000,
                scraper_timeout: parseFloat(document.getElementById('cfg-scraper-timeout').value) || 120.0,
                scraper_max_tokens: parseInt(document.getElementById('cfg-scraper-max-tokens').value) || 30000,
                autoupdate_on_launch: document.getElementById('cfg-autoupdate-on-launch').checked,
                max_api_retries: parseInt(document.getElementById('cfg-max-api-retries').value) || 20,
                api_retry_delay: parseFloat(document.getElementById('cfg-api-retry-delay').value) || 15.0,
                quota_retry_delay: parseFloat(document.getElementById('cfg-quota-retry-delay').value) || 120.0,
                max_research_agents: parseInt(document.getElementById('cfg-max-research-agents').value) || 4,
                research_context_tokens: parseInt(document.getElementById('cfg-research-context-tokens').value) || 28000,
                research_min_length: parseInt(document.getElementById('cfg-research-min-length').value) || 5000,
                max_shrink_attempts: parseInt(document.getElementById('cfg-max-shrink-attempts').value) || 15,
                pdf_dpi: parseInt(document.getElementById('cfg-pdf-dpi').value) || 150,
                pdf_footer_text: document.getElementById('cfg-pdf-footer-text').value.trim(),
                research_image_system_enabled: document.getElementById('cfg-research-image-enabled').checked,
                research_images_max: parseInt(document.getElementById('cfg-research-images-max').value) || 10,
                research_image_retries: parseInt(document.getElementById('cfg-research-image-retries').value) || 1,
                research_images_as_links: !document.getElementById('cfg-research-images-links').checked,
                tool_result_visibility: document.getElementById('cfg-tool-vis').value,
                keep_verbatim_count: parseInt(document.getElementById('cfg-keep-verbatim-count').value) || 2
            };
            sendToPython({ action: "save_global_settings", settings });
            closeModals();
        };

        function showToolModal(msg) {
            currentCallId = msg.call_id;
            const titleEl = document.getElementById('modal-tool-title');
            const descEl = document.getElementById('modal-tool-desc');
            const argsEl = document.getElementById('modal-tool-args');
            const clarifyBox = document.getElementById('clarify-input-box');
            const clarifyInput = document.getElementById('clarify-user-input');
            const optionsBox = document.getElementById('clarify-options-container');
            const approveBtn = document.getElementById('btn-approve');

            optionsBox.innerHTML = '';

            if (msg.tool_name === "get_user_clarification") {
                titleEl.style.color = 'var(--brand-teal)';
                titleEl.innerText = 'Clarification Required: ' + msg.agent_name;
                descEl.innerText = 'Select an option or provide a custom response for ' + msg.agent_name + ':';
                argsEl.style.display = 'none';

                const options = (msg.arguments && msg.arguments.options) ? msg.arguments.options : [];
                if (options.length > 0) {
                    optionsBox.style.display = 'flex';
                    options.forEach(function(opt) {
                        const pill = document.createElement('div');
                        pill.style.cssText = 'background: var(--bg-card); border: 1px solid var(--brand-teal); border-radius: 8px; padding: 9px 12px; font-size: 0.84rem; color: var(--text-main); cursor: pointer; font-weight: 500; transition: all 0.2s ease;';
                        pill.innerHTML = '<span> ' + window.electronAPI.escapeHtml(opt) + '</span>';
                        pill.onclick = function() {
                            document.getElementById('tool-modal').style.display = 'none';
                            sendToPython({
                                action: "tool_response",
                                call_id: currentCallId,
                                approved: true,
                                response: opt
                            });
                        };
                        optionsBox.appendChild(pill);
                    });
                } else {
                    optionsBox.style.display = 'none';
                }

                clarifyBox.style.display = 'block';
                clarifyInput.value = '';
                approveBtn.innerText = 'Submit Response';
                setTimeout(function() { clarifyInput.focus(); }, 120);
            } else {
                titleEl.style.color = 'var(--brand-yellow)';
                titleEl.innerText = 'Tool Authorization: ' + msg.tool_name + ' (' + msg.agent_name + ')';
                descEl.innerText = 'The agent has requested execution of the following action:';
                argsEl.style.display = 'block';
                argsEl.innerText = JSON.stringify(msg.arguments, null, 2);
                optionsBox.style.display = 'none';
                clarifyBox.style.display = 'none';
                approveBtn.innerText = 'Approve';
            }

            document.getElementById('tool-modal').style.display = 'flex';
        }

        document.getElementById('btn-approve').onclick = function() {
            document.getElementById('tool-modal').style.display = 'none';
            const clarifyVal = document.getElementById('clarify-user-input').value.trim();
            sendToPython({ 
                action: "tool_response", 
                call_id: currentCallId, 
                approved: true,
                response: clarifyVal || true
            });
        };

        document.getElementById('clarify-user-input').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                document.getElementById('btn-approve').click();
            }
        });

        document.getElementById('btn-reject').onclick = function() {
            document.getElementById('tool-modal').style.display = 'none';
            sendToPython({ action: "tool_response", call_id: currentCallId, approved: false, response: false });
        };

        document.getElementById('btn-modal-abort').onclick = function() {
            document.getElementById('tool-modal').style.display = 'none';
            sendToPython({ action: "tool_response", call_id: currentCallId, approved: false, response: false });
            sendToPython({ action: "abort" });
            workingAgentsMap.clear();
            workingIndicator.style.display = "none";
            stopReactorAnimation();
            appendLog("[bold red]Operation Aborted by User.[/bold red]", false);
        };

        

        document.getElementById('btn-keyring-bio').onclick = () => {
            const pwd = document.getElementById('keyring-password-input').value;
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ 
                    type: "_trigger_biometrics", 
                    password: pwd 
                }));
            }
        };

        document.getElementById('btn-keyring-unlock').onclick = () => {
            const pwd = document.getElementById('keyring-password-input').value;
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: "_cache_keyring_pwd", password: pwd }));
            }
            sendToPython({ action: "keyring_unlock", password: pwd });
        };

        document.getElementById('btn-keyring-reset').onclick = () => {
            const pwd = document.getElementById('keyring-password-input').value;
            if (!pwd) {
                document.getElementById('keyring-error-msg').innerText = "Please enter a password to reset.";
                return;
            }
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: "_cache_keyring_pwd", password: pwd }));
            }
            sendToPython({ action: "keyring_reset", password: pwd });
        };

        document.getElementById('keyring-password-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('btn-keyring-unlock').click();
        });

        // --- FIND & REPLACE CONTROLLER ---
        function openFindReplaceModal() {
            document.getElementById('find-replace-modal').style.display = 'flex';
            document.getElementById('fr-find-input').focus();
        }

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                openFindReplaceModal();
            }
        });

        let activeMatchIdx = -1;
        function performSearch(direction = 1) {
            const searchTerm = document.getElementById('fr-find-input').value;
            const matchCase = document.getElementById('fr-case-cb').checked;
            const statusEl = document.getElementById('fr-status-msg');

            if (!searchTerm) {
                statusEl.innerText = "Please enter search text.";
                return;
            }

            document.querySelectorAll('mark.fr-highlight').forEach(el => {
                el.outerHTML = el.innerHTML;
            });

            const contentEl = document.getElementById('chat-container');
            const treeWalker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            while (treeWalker.nextNode()) textNodes.push(treeWalker.currentNode);

            let matches = [];
            textNodes.forEach(node => {
                const text = matchCase ? node.nodeValue : node.nodeValue.toLowerCase();
                const query = matchCase ? searchTerm : searchTerm.toLowerCase();
                let pos = text.indexOf(query);
                while (pos !== -1) {
                    matches.push({ node, pos, len: query.length });
                    pos = text.indexOf(query, pos + query.length);
                }
            });

            if (matches.length === 0) {
                statusEl.innerText = "String not found.";
                return;
            }

            statusEl.innerText = 'Found ' + matches.length + ' matches.';

            matches.forEach(m => {
                const range = document.createRange();
                range.setStart(m.node, m.pos);
                range.setEnd(m.node, m.pos + m.len);
                const mark = document.createElement('mark');
                mark.className = 'fr-highlight';
                mark.style.backgroundColor = '#f2a813';
                mark.style.color = '#000';
                mark.style.borderRadius = '2px';
                range.surroundContents(mark);
            });

            const allMarks = document.querySelectorAll('mark.fr-highlight');
            if (allMarks.length > 0) {
                activeMatchIdx = (activeMatchIdx + direction + allMarks.length) % allMarks.length;
                allMarks.forEach((m, idx) => {
                    m.style.backgroundColor = (idx === activeMatchIdx) ? '#3ddbd9' : '#f2a813';
                });
                allMarks[activeMatchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        document.getElementById('fr-btn-next').onclick = () => performSearch(1);
        document.getElementById('fr-btn-prev').onclick = () => performSearch(-1);

        document.getElementById('fr-btn-replace').onclick = () => {
            const allMarks = document.querySelectorAll('mark.fr-highlight');
            const replaceText = document.getElementById('fr-replace-input').value;
            if (activeMatchIdx >= 0 && activeMatchIdx < allMarks.length) {
                allMarks[activeMatchIdx].outerHTML = replaceText;
                performSearch(0);
            }
        };

        document.getElementById('fr-btn-all').onclick = () => {
            const allMarks = document.querySelectorAll('mark.fr-highlight');
            const replaceText = document.getElementById('fr-replace-input').value;
            const count = allMarks.length;
            allMarks.forEach(mark => {
                mark.outerHTML = replaceText;
            });
            document.getElementById('fr-status-msg').innerText = 'Replaced ' + count + ' occurrences.';
        };
    </script>
</body>
</html>
`;

export default function App() {
  const webViewRef = useRef(null);
  const scrollViewRef = useRef(null);

  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  const [isInitializing, setIsInitializing] = useState(true);
  const [initStatus, setInitStatus] = useState('Initializing Termux engine...');
  const [termuxLogs, setTermuxLogs] = useState([]);
  const [showTermuxModal, setShowTermuxModal] = useState(false);
  const [fatalError, setFatalError] = useState(null);

  // Catch unhandled JS errors and show them on-screen
  useEffect(() => {
    if (global.ErrorUtils) {
      const defaultHandler = global.ErrorUtils.getGlobalHandler();
      global.ErrorUtils.setGlobalHandler((error, isFatal) => {
        setFatalError(error?.stack || error?.message || String(error));
        if (defaultHandler) defaultHandler(error, isFatal);
      });
    }
  }, []);

  const addTermuxLog = useCallback((message, level = 'info') => {
    const time = new Date().toTimeString().split(' ')[0];
    setTermuxLogs((prev) => [...prev.slice(-200), { time, level, message }]);
  }, []);

  // Biometric Keyring Unlock Routine with immediate UI feedback
  // Auto-resummon biometric prompt when returning to the app if keyring is still locked
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        webViewRef.current?.injectJavaScript(`
          (function() {
            const modal = document.getElementById('keyring-modal');
            if (modal && (modal.style.display === 'flex' || window.getComputedStyle(modal).display === 'flex')) {
              if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: "_trigger_biometrics" }));
              }
            }
          })();
          true;
        `);
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);

  const triggerBiometricUnlock = useCallback(async (fallbackPwd = '') => {
    try {
      let secret = await SecureStore.getItemAsync('federaide_keyring_secret');
      
      // If user typed a password in the input field, use and cache it
      if (fallbackPwd && fallbackPwd.trim()) {
        secret = fallbackPwd.trim();
        await SecureStore.setItemAsync('federaide_keyring_secret', secret);
      }

      if (!secret) {
        addTermuxLog('[AUTH] No saved Keyring secret found in KeyStore. Enter password once to register.', 'warn');
        webViewRef.current?.injectJavaScript(`
          (function() {
            const errEl = document.getElementById('keyring-error-msg');
            if (errEl) errEl.innerText = "Enter password once & unlock to enable biometrics.";
          })();
          true;
        `);
        return false;
      }

      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock FEDERaiDE Keyring',
        cancelLabel: 'Use Password',
        disableDeviceFallback: false,
      });

      if (authResult.success) {
        addTermuxLog('[AUTH] Biometric authentication verified. Unlocking Keyring...', 'success');
        if (TermuxNative && TermuxNative.sendToPython) {
          TermuxNative.sendToPython(JSON.stringify({
            action: 'keyring_unlock',
            password: secret,
          }));
        }
        return true;
      } else {
        addTermuxLog('[AUTH] Biometric prompt cancelled or failed.', 'warn');
        webViewRef.current?.injectJavaScript(`
          (function() {
            const errEl = document.getElementById('keyring-error-msg');
            if (errEl) errEl.innerText = "Biometric authentication cancelled.";
          })();
          true;
        `);
      }
    } catch (bioErr) {
      console.error('[Biometrics Error]', bioErr);
      addTermuxLog(`[AUTH Error] ${bioErr.message}`, 'error');
    }
    return false;
  }, [addTermuxLog]);

  const isInitializingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    // Request notification permissions
    Notifications.requestPermissionsAsync().catch(() => {});

    async function initTermuxAndBridge() {
      if (isInitializingRef.current) return;
      isInitializingRef.current = true;

      try {
        if (!TermuxNative) {
          addTermuxLog('[WARN] TermuxNative module not detected.');
          setIsInitializing(false);
          return;
        }
        // Check if there was a native crash from a previous launch
        try {
          if (TermuxNative.getLastCrashLog) {
            const crash = await TermuxNative.getLastCrashLog();
            if (crash) {
              addTermuxLog(`[PREVIOUS NATIVE CRASH]\n${crash}`, 'error');
              setShowTermuxModal(true);
            }
          }
        } catch (_) {}
        // 1. Unpack bootstrap & proot
        if (isMounted) setInitStatus('Extracting Termux rootfs...');
        addTermuxLog('[INIT] Setting up Termux environment...');
        await TermuxNative.setupEnvironment();

        // 2. Check if federaide is installed in the uv environment or system
        if (isMounted) setInitStatus('Checking FEDERaiDE engine...');
        addTermuxLog('[INIT] Checking FEDERaiDE package installation...');
        const checkInstalled = await TermuxNative.executeCommand(
          'bash',
          ['-c', 'if [ -d "$HOME/.local/share/uv/tools/federaide" ] || python3 -c "import federate" 2>/dev/null; then echo "OK"; else echo "MISSING"; fi'],
          ''
        );

        if (!checkInstalled.output || !checkInstalled.output.includes('OK')) {
          if (isMounted) setInitStatus('Running FEDERaiDE installer script (install.sh)...');
          addTermuxLog('[INIT] FEDERaiDE missing. Launching install.sh...');
          
          const installResult = await TermuxNative.executeCommand(
            'bash',
            ['-c', 'cd "$HOME" && . "$HOME/install.sh"'],
            ''
          );

          if (installResult.exitCode !== 0) {
            addTermuxLog(`[ERROR] Installer failed with code ${installResult.exitCode}. Halting.`, 'error');
            if (isMounted) setInitStatus(`Installer failed (code ${installResult.exitCode}). Check console.`);
            return;
          }
        }

        // 3. Start the persistent local agent bridge (stdio IPC)
        if (isMounted) setInitStatus('Starting local agent bridge...');
        addTermuxLog('[INIT] Starting Python backend bridge...');
        await TermuxNative.startPythonBridge();

        if (isMounted) {
          setInitStatus('Loading AI personas & episodic memory...');
          addTermuxLog('[INIT] Python bridge spawned, awaiting core readiness...');
        }
      } catch (err) {
        console.error('[Termux Init Error]', err);
        addTermuxLog(`[ERROR] Initialization failed: ${err.message}`, 'error');
        if (isMounted) {
          setInitStatus(`Initialization failed: ${err.message}`);
        }
      }
    }

    initTermuxAndBridge();

    // Listen for Termux native events
    const logListener = (event) => {
      const logMsg = typeof event === 'string' ? event : (event?.message || '');
      addTermuxLog(logMsg, logMsg.includes('[STDERR]') ? 'error' : 'info');
    };

    const pyListener = (event) => {
      try {
        const rawMsg = typeof event === 'string' ? event : (event?.raw || '');

        // Seamlessly dismiss the loader the moment Python reports ready status or requests Keyring unlock
        if (rawMsg) {
          if (rawMsg.includes('"keyring_unlock_required"')) {
            setIsInitializing(false);
            triggerBiometricUnlock();
          } else if (
            rawMsg.includes('"init"') ||
            rawMsg.includes('"status_bar"') ||
            rawMsg.includes('"keyring_unlock_success"')
          ) {
            setIsInitializing(false);
          }

          // Trigger native system chime & notification if app is in background
          if (AppState.currentState !== 'active') {
            try {
              const parsed = typeof rawMsg === 'string' ? JSON.parse(rawMsg) : rawMsg;
              if (parsed.type === 'message_block') {
                const header = (parsed.header || 'Agent').replace(/:\s*$/, '').replace(/\[\/?.*?\]/g, '');
                triggerBackgroundNotification(`✦ ${header}`, parsed.content || 'New response ready.');
              } else if (parsed.type === 'tool_result' || parsed.type === 'tool_error') {
                const isErr = parsed.type === 'tool_error';
                const title = isErr ? `⚠️ Tool Error (${parsed.agent || 'Agent'})` : `✓ Action Complete (${parsed.agent || 'Agent'})`;
                triggerBackgroundNotification(title, parsed.summary || 'Tool finished execution.');
              }
            } catch (_) {}
          }
        }

        const injectedCode = `(function() {
          if (typeof window.__receiveFromPython === 'function') {
            window.__receiveFromPython(${JSON.stringify(rawMsg)});
          } else {
            window.__pendingQueue = window.__pendingQueue || [];
            try { window.__pendingQueue.push(JSON.parse(${JSON.stringify(rawMsg)})); } catch(e) {}
          }
        })(); true;`;
        webViewRef.current?.injectJavaScript(injectedCode);
      } catch (err) {
        console.error('[Bridge UI Relay Error]', err);
      }
    };

    const termuxLogSub = termuxEmitter
      ? termuxEmitter.addListener('onTermuxLog', logListener)
      : NativeModules.DeviceEventEmitter?.addListener('onTermuxLog', logListener);

    const pyMsgSub = termuxEmitter
      ? termuxEmitter.addListener('onPythonMessage', pyListener)
      : NativeModules.DeviceEventEmitter?.addListener('onPythonMessage', pyListener);

    const backAction = () => {
      if (showTermuxModal) {
        setShowTermuxModal(false);
        return true;
      }

      webViewRef.current?.injectJavaScript(`
        if (typeof closeModals === 'function') closeModals();
        if (typeof toggleDrawer === 'function') toggleDrawer(false);
        true;
      `);
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);

    return () => {
      isMounted = false;
      termuxLogSub.remove();
      pyMsgSub.remove();
      backHandler.remove();
    };
  }, []);

  // Auto-scroll the setup logs
  useEffect(() => {
      if (scrollViewRef.current && isInitializing) {
          scrollViewRef.current.scrollToEnd({ animated: true });
      }
  }, [termuxLogs, isInitializing]);

  // Process incoming share intents from external apps using expo-share-intent
  useEffect(() => {
    if (hasShareIntent && !isInitializing && shareIntent) {
      const processIncomingShare = async () => {
        try {
          addTermuxLog(`[Share Intent] Processing: ${JSON.stringify(shareIntent)}`);

          let fileList = [];
          if (shareIntent.files && Array.isArray(shareIntent.files) && shareIntent.files.length > 0) {
            fileList = shareIntent.files;
          } else if (shareIntent.value && (shareIntent.type === 'file' || shareIntent.type === 'media')) {
            fileList = [{ path: String(shareIntent.value), fileName: String(shareIntent.value).split('/').pop() }];
          }

          if (fileList.length > 0) {
            for (const f of fileList) {
              const uri = f.path || f.contentUrl || f.uri;
              if (!uri) continue;

              let filename = f.fileName || f.name || uri.split('/').pop() || `shared_${Date.now()}`;
              if (filename.includes('?')) filename = filename.split('?')[0];

              // Clean file URI prefix for direct on-device copy
              const cleanSourcePath = uri.replace('file://', '');

              if (TermuxNative && TermuxNative.sendToPython) {
                TermuxNative.sendToPython(JSON.stringify({
                  action: "import_shared_file",
                  source_path: cleanSourcePath,
                  filename: filename
                }));
              }

              addTermuxLog(`[Share Intent] Imported to workspace: ${filename}`, 'success');

              // Inject &<filename> into chat input bar and focus
              webViewRef.current?.injectJavaScript(`
                if (typeof window.handleIncomingSharedFile === 'function') {
                  window.handleIncomingSharedFile(${JSON.stringify(filename)});
                }
                true;
              `);
            }
          }
        } catch (err) {
          console.error('[Share Intent Process Error]', err);
          addTermuxLog(`[Share Intent Error] ${err.message}`, 'error');
        } finally {
          resetShareIntent();
        }
      };
      processIncomingShare();
    }
  }, [hasShareIntent, shareIntent, isInitializing, resetShareIntent, addTermuxLog]);


  // Forward IPC messages from WebView directly into Python's stdin
  const handleWebViewMessage = useCallback(async (event) => {
    try {
      const rawData = event.nativeEvent.data;
      const parsed = JSON.parse(rawData);

      if (parsed.type === '_request_full_auto_auth') {
        try {
          const authResult = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Authorize Full-Auto Execution Mode',
            cancelLabel: 'Cancel',
            disableDeviceFallback: false,
          });

          if (authResult.success) {
            addTermuxLog('[AUTH] Biometric verification confirmed. FULL-AUTO mode enabled.', 'success');
            webViewRef.current?.injectJavaScript(`
              if (typeof window.__confirmFullAutoMode === 'function') {
                window.__confirmFullAutoMode();
              }
              true;
            `);
          } else {
            addTermuxLog('[AUTH] Full-Auto biometric authorization cancelled or failed.', 'warn');
            webViewRef.current?.injectJavaScript(`
              if (typeof window.__rejectFullAutoMode === 'function') {
                window.__rejectFullAutoMode();
              }
              true;
            `);
          }
        } catch (authErr) {
          console.error('[Full-Auto Auth Error]', authErr);
          addTermuxLog(`[AUTH Error] ${authErr.message}`, 'error');
        }
        return;
      }

      if (parsed.type === '_open_url' && parsed.url) {
        Linking.openURL(parsed.url);
        return;
      }
      
      if (parsed.type === '_open_termux_console') {
          setShowTermuxModal(true);
          return;
      }

      if (parsed.type === '_trigger_biometrics') {
        triggerBiometricUnlock(parsed.password);
        return;
      }

      // Auto-cache password to secure hardware storage whenever user enters or resets it
      if ((parsed.action === 'keyring_unlock' || parsed.action === 'keyring_reset') && parsed.password) {
        SecureStore.setItemAsync('federaide_keyring_secret', String(parsed.password).trim())
          .then(() => addTermuxLog('[AUTH] Keyring password saved to hardware KeyStore for biometrics.', 'success'))
          .catch((e) => console.warn('[SecureStore Cache Error]', e));
      }

      if (parsed.type === '_share_file_path') {
        try {
          const destUri = `${FileSystem.cacheDirectory}${parsed.filename}`;
          
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(destUri, {
              mimeType: parsed.mime_type || 'application/octet-stream',
              dialogTitle: `Share ${parsed.filename}`,
            });
          } else {
            addTermuxLog('[WARN] Sharing is not available on this device.', 'error');
          }
        } catch (shareErr) {
          console.error('[Share Error]', shareErr);
          addTermuxLog(`[Share Error] ${shareErr.message}`, 'error');
          // Fallback if cacheDirectory path resolution differed
          try {
            await Sharing.shareAsync(`file://${parsed.path}`, {
              mimeType: parsed.mime_type || 'application/octet-stream',
              dialogTitle: `Share ${parsed.filename}`,
            });
          } catch (fallbackErr) {
            addTermuxLog(`[Share Fallback Error] ${fallbackErr.message}`, 'error');
          }
        }
        return;
      }

      if (TermuxNative && TermuxNative.sendToPython) {
        TermuxNative.sendToPython(rawData);
      }
    } catch (e) {
      console.error('[WebView Message Forward Error]', e);
    }
  }, []);

  if (fatalError) {
    return (
      <SafeAreaView style={[styles.container, { padding: 20, backgroundColor: '#150606' }]}>
        <StatusBar barStyle="light-content" backgroundColor="#150606" />
        <Text style={{ color: '#da6057', fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>
          Fatal JS Error Caught:
        </Text>
        <ScrollView style={{ flex: 1, backgroundColor: '#090a0d', padding: 10, borderRadius: 8 }}>
          <Text style={{ color: '#f0f2f5', fontFamily: 'monospace', fontSize: 12 }}>
            {fatalError}
          </Text>
        </ScrollView>
        <TouchableOpacity
          style={{ backgroundColor: '#da6057', padding: 12, borderRadius: 8, marginTop: 15, alignItems: 'center' }}
          onPress={() => setFatalError(null)}
        >
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>Dismiss & Continue</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#060709" />

      

      {/* Initialization Loader Overlay (with Live Logs) */}
      {isInitializing && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#3ddbd9" />
          <Text style={styles.loadingText}>{initStatus}</Text>
          <ScrollView 
            ref={scrollViewRef}
            style={styles.setupLogScroll} 
            contentContainerStyle={styles.setupLogContent}
          >
              {termuxLogs.slice(-100).map((log, index) => (
                  <Text key={index} style={[styles.debugLogLine, { color: log.level === 'error' ? '#da6057' : '#f0f2f5' }]}>
                    {log.message}
                  </Text>
              ))}
          </ScrollView>
        </View>
      )}

      {/* Embedded High-Fidelity WebView Interface */}
      <View style={styles.flexContainer}>
        <WebView
          ref={webViewRef}
          source={{ html: COMPLETE_CLIENT_HTML, baseUrl: 'https://federaide.rocklab.in' }}
          originWhitelist={['*']}
          onMessage={handleWebViewMessage}
          onLoadEnd={() => {
            if (TermuxNative && TermuxNative.sendToPython) {
              TermuxNative.sendToPython(JSON.stringify({ action: 'get_status' }));
            }
          }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowFileAccess={false}
          mixedContentMode="never"
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          style={styles.webView}
          scalesPageToFit={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        />
      </View>

      {/* Termux Console Debug Modal */}
      {showTermuxModal && (
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.debugModalCard]}>
            <View style={styles.debugHeaderRow}>
              <Text style={styles.debugModalTitle}>Termux Backend Console</Text>
              <View style={[styles.statusDot, { backgroundColor: '#3ddbd9' }]} />
            </View>

            <ScrollView 
              style={styles.debugLogScroll} 
              contentContainerStyle={styles.debugLogContent}
              nestedScrollEnabled={true}
            >
              {termuxLogs.length === 0 ? (
                <Text style={styles.debugEmptyText}>No output intercepted yet...</Text>
              ) : (
                termuxLogs.map((log, index) => {
                  let color = '#f0f2f5';
                  if (log.level === 'error') color = '#da6057';
                  else if (log.level === 'warn') color = '#f2a813';
                  else if (log.level === 'success') color = '#8cc84b';
                  return (
                    <Text key={index} style={[styles.debugLogLine, { color }]}>
                      <Text style={styles.debugLogTime}>[{log.time}] </Text>
                      {log.message}
                    </Text>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.btn, styles.btnCancel]}
                onPress={() => setTermuxLogs([])}
              >
                <Text style={styles.btnTextWhite}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnSave]}
                onPress={() => setShowTermuxModal(false)}
              >
                <Text style={styles.btnTextBlack}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060709',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  flexContainer: {
    flex: 1,
  },
  webView: {
    flex: 1,
    backgroundColor: '#060709',
  },
  loadingOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: '#060709',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    padding: 20,
  },
  loadingText: {
    color: '#3ddbd9',
    marginTop: 15,
    marginBottom: 15,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    textAlign: 'center',
  },
  setupLogScroll: {
    width: '100%',
    maxHeight: 250,
    backgroundColor: '#0e1015',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 10,
  },
  setupLogContent: {
    paddingBottom: 10,
  },
  modalBackdrop: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0e1015',
    borderWidth: 1,
    borderColor: '#3ddbd9',
    borderRadius: 16,
    padding: 20,
  },
  debugModalCard: {
    maxWidth: 480,
    maxHeight: '80%',
    height: 440,
  },
  debugHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  debugModalTitle: {
    color: '#f0f2f5',
    fontSize: 16,
    fontWeight: '700',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  debugLogScroll: {
    flex: 1,
    backgroundColor: '#060709',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 8,
    marginBottom: 12,
  },
  debugLogContent: {
    paddingBottom: 8,
  },
  debugEmptyText: {
    color: '#7e8494',
    fontSize: 12,
    fontStyle: 'italic',
  },
  debugLogLine: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 16,
    marginBottom: 2,
  },
  debugLogTime: {
    color: '#7e8494',
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  btnCancel: {
    backgroundColor: '#1f2330',
  },
  btnSave: {
    backgroundColor: '#3ddbd9',
  },
  btnTextWhite: {
    color: '#f0f2f5',
    fontWeight: '600',
  },
  btnTextBlack: {
    color: '#060709',
    fontWeight: '700',
  },
});