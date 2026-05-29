import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { Text } from '../../../ink.js';
import { BashTool } from '../../../tools/BashTool/BashTool.js';
import type { PermissionRuleValue } from '../../../utils/permissions/PermissionRule.js';
type RuleSubtitleProps = {
  ruleValue: PermissionRuleValue;
};
export function PermissionRuleDescription(t0) {
  const $ = _c(13);
  const {
    ruleValue
  } = t0;
  const {
    t
  } = useTranslation();
  switch (ruleValue.toolName) {
    case BashTool.name:
      {
        if (ruleValue.ruleContent) {
          if (ruleValue.ruleContent.endsWith(":*")) {
            let t1;
            if ($[0] !== ruleValue.ruleContent) {
              t1 = ruleValue.ruleContent.slice(0, -2);
              $[0] = ruleValue.ruleContent;
              $[1] = t1;
            } else {
              t1 = $[1];
            }
            let t2;
            if ($[2] !== t1 || $[9] !== t) {
              const [bashStartingWithA, bashStartingWithB] = t('permission.ruleDescription.bashStartingWith').split('{prefix}');
              t2 = <Text dimColor={true}>{bashStartingWithA}<Text bold={true}>{t1}</Text>{bashStartingWithB}</Text>;
              $[2] = t1;
              $[9] = t;
              $[3] = t2;
            } else {
              t2 = $[3];
            }
            return t2;
          } else {
            let t1;
            if ($[4] !== ruleValue.ruleContent || $[10] !== t) {
              const [bashCommandA, bashCommandB] = t('permission.ruleDescription.bashCommand').split('{command}');
              t1 = <Text dimColor={true}>{bashCommandA}<Text bold={true}>{ruleValue.ruleContent}</Text>{bashCommandB}</Text>;
              $[4] = ruleValue.ruleContent;
              $[10] = t;
              $[5] = t1;
            } else {
              t1 = $[5];
            }
            return t1;
          }
        } else {
          let t1;
          if ($[6] !== t) {
            t1 = <Text dimColor={true}>{t('permission.ruleDescription.anyBash')}</Text>;
            $[6] = t;
            $[11] = t1;
          } else {
            t1 = $[11];
          }
          return t1;
        }
      }
    default:
      {
        if (!ruleValue.ruleContent) {
          let t1;
          if ($[7] !== ruleValue.toolName || $[12] !== t) {
            const [anyToolUseA, anyToolUseB] = t('permission.ruleDescription.anyToolUse').split('{toolName}');
            t1 = <Text dimColor={true}>{anyToolUseA}<Text bold={true}>{ruleValue.toolName}</Text>{anyToolUseB}</Text>;
            $[7] = ruleValue.toolName;
            $[12] = t;
            $[8] = t1;
          } else {
            t1 = $[8];
          }
          return t1;
        } else {
          return null;
        }
      }
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIlRleHQiLCJCYXNoVG9vbCIsIlBlcm1pc3Npb25SdWxlVmFsdWUiLCJSdWxlU3VidGl0bGVQcm9wcyIsInJ1bGVWYWx1ZSIsIlBlcm1pc3Npb25SdWxlRGVzY3JpcHRpb24iLCJ0MCIsIiQiLCJfYyIsInRvb2xOYW1lIiwibmFtZSIsInJ1bGVDb250ZW50IiwiZW5kc1dpdGgiLCJ0MSIsInNsaWNlIiwidDIiLCJTeW1ib2wiLCJmb3IiXSwic291cmNlcyI6WyJQZXJtaXNzaW9uUnVsZURlc2NyaXB0aW9uLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBSZWFjdCBmcm9tICdyZWFjdCdcbmltcG9ydCB7IFRleHQgfSBmcm9tICcuLi8uLi8uLi9pbmsuanMnXG5pbXBvcnQgeyBCYXNoVG9vbCB9IGZyb20gJy4uLy4uLy4uL3Rvb2xzL0Jhc2hUb29sL0Jhc2hUb29sLmpzJ1xuaW1wb3J0IHR5cGUgeyBQZXJtaXNzaW9uUnVsZVZhbHVlIH0gZnJvbSAnLi4vLi4vLi4vdXRpbHMvcGVybWlzc2lvbnMvUGVybWlzc2lvblJ1bGUuanMnXG5cbnR5cGUgUnVsZVN1YnRpdGxlUHJvcHMgPSB7XG4gIHJ1bGVWYWx1ZTogUGVybWlzc2lvblJ1bGVWYWx1ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gUGVybWlzc2lvblJ1bGVEZXNjcmlwdGlvbih7XG4gIHJ1bGVWYWx1ZSxcbn06IFJ1bGVTdWJ0aXRsZVByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgc3dpdGNoIChydWxlVmFsdWUudG9vbE5hbWUpIHtcbiAgICBjYXNlIEJhc2hUb29sLm5hbWU6IHtcbiAgICAgIGlmIChydWxlVmFsdWUucnVsZUNvbnRlbnQpIHtcbiAgICAgICAgaWYgKHJ1bGVWYWx1ZS5ydWxlQ29udGVudC5lbmRzV2l0aCgnOionKSkge1xuICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8VGV4dCBkaW1Db2xvcj5cbiAgICAgICAgICAgICAgQW55IEJhc2ggY29tbWFuZCBzdGFydGluZyB3aXRoeycgJ31cbiAgICAgICAgICAgICAgPFRleHQgYm9sZD57cnVsZVZhbHVlLnJ1bGVDb250ZW50LnNsaWNlKDAsIC0yKX08L1RleHQ+XG4gICAgICAgICAgICA8L1RleHQ+XG4gICAgICAgICAgKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8VGV4dCBkaW1Db2xvcj5cbiAgICAgICAgICAgICAgVGhlIEJhc2ggY29tbWFuZCA8VGV4dCBib2xkPntydWxlVmFsdWUucnVsZUNvbnRlbnR9PC9UZXh0PlxuICAgICAgICAgICAgPC9UZXh0PlxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIDxUZXh0IGRpbUNvbG9yPkFueSBCYXNoIGNvbW1hbmQ8L1RleHQ+XG4gICAgICB9XG4gICAgfVxuICAgIGRlZmF1bHQ6IHtcbiAgICAgIGlmICghcnVsZVZhbHVlLnJ1bGVDb250ZW50KSB7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPFRleHQgZGltQ29sb3I+XG4gICAgICAgICAgICBBbnkgdXNlIG9mIHRoZSA8VGV4dCBib2xkPntydWxlVmFsdWUudG9vbE5hbWV9PC9UZXh0PiB0b29sXG4gICAgICAgICAgPC9UZXh0PlxuICAgICAgICApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuIl0sIm1hcHBpbmdzIjoiO0FBQUEsT0FBTyxLQUFLQSxLQUFLLE1BQU0sT0FBTztBQUM5QixTQUFTQyxJQUFJLFFBQVEsaUJBQWlCO0FBQ3RDLFNBQVNDLFFBQVEsUUFBUSxxQ0FBcUM7QUFDOUQsY0FBY0MsbUJBQW1CLFFBQVEsOENBQThDO0FBRXZGLEtBQUtDLGlCQUFpQixHQUFHO0VBQ3ZCQyxTQUFTLEVBQUVGLG1CQUFtQjtBQUNoQyxDQUFDO0FBRUQsT0FBTyxTQUFBRywwQkFBQUMsRUFBQTtFQUFBLE1BQUFD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