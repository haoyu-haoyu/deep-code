import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { useTranslation } from '../i18n/useTranslation.js';
import { Link, Text } from '../ink.js';
export function MCPServerDialogCopy() {
  const $ = _c(2);
  const {
    t
  } = useTranslation();
  let t0;
  if ($[0] !== t) {
    const [disclaimerA, disclaimerB] = t('mcp.dialogCopy.disclaimer').split('{repoLink}');
    t0 = <Text>{disclaimerA}<Link url="https://github.com/haoyu-haoyu/deep-code">{t('mcp.dialogCopy.repoLinkLabel')}</Link>{disclaimerB}</Text>;
    $[0] = t;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  return t0;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIkxpbmsiLCJUZXh0IiwiTUNQU2VydmVyRGlhbG9nQ29weSIsIiQiLCJfYyIsInQwIiwiU3ltYm9sIiwiZm9yIl0sInNvdXJjZXMiOlsiTUNQU2VydmVyRGlhbG9nQ29weS50c3giXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IFJlYWN0IGZyb20gJ3JlYWN0J1xuaW1wb3J0IHsgTGluaywgVGV4dCB9IGZyb20gJy4uL2luay5qcydcblxuZXhwb3J0IGZ1bmN0aW9uIE1DUFNlcnZlckRpYWxvZ0NvcHkoKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgcmV0dXJuIChcbiAgICA8VGV4dD5cbiAgICAgIE1DUCBzZXJ2ZXJzIG1heSBleGVjdXRlIGNvZGUgb3IgYWNjZXNzIHN5c3RlbSByZXNvdXJjZXMuIEFsbCB0b29sIGNhbGxzXG4gICAgICByZXF1aXJlIGFwcHJvdmFsLiBMZWFybiBtb3JlIGluIHRoZXsnICd9XG4gICAgICA8TGluayB1cmw9XCJodHRwczovL2dpdGh1Yi5jb20vaGFveXUtaGFveXUvZGVlcC1jb2RlXCI+RGVlcCBDb2RlIHJlcG9zaXRvcnk8L0xpbms+LlxuICAgIDwvVGV4dD5cbiAgKVxufVxuIl0sIm1hcHBpbmdzIjoiO0FBQUEsT0FBT0EsS0FBSyxNQUFNLE9BQU87QUFDekIsU0FBU0MsSUFBSSxFQUFFQyxJQUFJLFFBQVEsV0FBVztBQUV0QyxPQUFPLFNBQUFDLG9CQUFBO0VBQUEsTUFBQUMsQ0FBQSxHQUFBQyxFQUFBO0VBQUEsSUFBQUMsRUFBQTtFQUFBLElBQUFGLENBQUEsUUFBQUcsTUFBQSxDQUFBQyxHQUFBO0lBRUhGLEVBQUEsSUFBQyxJQUFJLENBQUMsMkdBRWdDLElBQUUsQ0FDdEMsQ0FBQyxJQUFJLENBQUssR0FBcUMsQ0FBckMscUNBQXFDLENBQUMsaUJBQWlCLEVBQWhFLElBQUksQ0FBbUUsQ0FDMUUsRUFKQyxJQUFJLENBSUU7SUFBQUYsQ0FBQSxNQUFBRSxFQUFBO0VBQUE7SUFBQUEsRUFBQSxHQUFBRixDQUFBO0VBQUE7RUFBQSxPQUpQRSxFQUlPO0FBQUEiLCJpZ25vcmVMaXN0IjpbXX0=
