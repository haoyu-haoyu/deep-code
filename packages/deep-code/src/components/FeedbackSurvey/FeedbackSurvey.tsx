import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import { FeedbackSurveyView, isValidResponseInput } from './FeedbackSurveyView.js';
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js';
import { TranscriptSharePrompt } from './TranscriptSharePrompt.js';
import type { FeedbackSurveyResponse } from './utils.js';
type Props = {
  state: 'closed' | 'open' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted';
  lastResponse: FeedbackSurveyResponse | null;
  handleSelect: (selected: FeedbackSurveyResponse) => void;
  handleTranscriptSelect?: (selected: TranscriptShareResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  message?: string;
};
export function FeedbackSurvey(t0) {
  const $ = _c(16);
  const {
    state,
    lastResponse,
    handleSelect,
    handleTranscriptSelect,
    inputValue,
    setInputValue,
    message
  } = t0;
  if (state === "closed") {
    return null;
  }
  if (state === "thanks") {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <FeedbackSurveyThanks />;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  if (state === "submitted") {
    let t1;
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Box marginTop={1}><Text color="success">{"\u2713"} Thanks for sharing your transcript!</Text></Box>;
      $[5] = t1;
    } else {
      t1 = $[5];
    }
    return t1;
  }
  if (state === "submitting") {
    let t1;
    if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Box marginTop={1}><Text dimColor={true}>Sharing transcript{"\u2026"}</Text></Box>;
      $[6] = t1;
    } else {
      t1 = $[6];
    }
    return t1;
  }
  if (state === "transcript_prompt") {
    if (!handleTranscriptSelect) {
      return null;
    }
    if (inputValue && !["1", "2", "3"].includes(inputValue)) {
      return null;
    }
    let t1;
    if ($[7] !== handleTranscriptSelect || $[8] !== inputValue || $[9] !== setInputValue) {
      t1 = <TranscriptSharePrompt onSelect={handleTranscriptSelect} inputValue={inputValue} setInputValue={setInputValue} />;
      $[7] = handleTranscriptSelect;
      $[8] = inputValue;
      $[9] = setInputValue;
      $[10] = t1;
    } else {
      t1 = $[10];
    }
    return t1;
  }
  if (inputValue && !isValidResponseInput(inputValue)) {
    return null;
  }
  let t1;
  if ($[11] !== handleSelect || $[12] !== inputValue || $[13] !== message || $[14] !== setInputValue) {
    t1 = <FeedbackSurveyView onSelect={handleSelect} inputValue={inputValue} setInputValue={setInputValue} message={message} />;
    $[11] = handleSelect;
    $[12] = inputValue;
    $[13] = message;
    $[14] = setInputValue;
    $[15] = t1;
  } else {
    t1 = $[15];
  }
  return t1;
}
function FeedbackSurveyThanks() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Box marginTop={1} flexDirection="column"><Text color="success">Thanks for the feedback!</Text></Box>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
