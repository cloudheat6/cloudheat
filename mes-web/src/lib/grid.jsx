import { useCallback, useEffect, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { useToast } from './toast.jsx'
import { AllCommunityModule, ModuleRegistry, colorSchemeDarkWarm, themeQuartz } from 'ag-grid-community'
import { AG_GRID_LOCALE_KR } from '@ag-grid-community/locale'

ModuleRegistry.registerModules([AllCommunityModule])

const params = {
  accentColor: '#ff5a1f',
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontWeight: 600,
  rowHeight: 36,
  headerHeight: 38,
  wrapperBorderRadius: 10,
}
const lightTheme = themeQuartz.withParams(params)
const darkTheme = themeQuartz.withPart(colorSchemeDarkWarm).withParams(params)

function useDark() {
  const q = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = (e) => setDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

export const defaultColDef = {
  sortable: true,
  resizable: true,
  filter: true,
  floatingFilter: true,
  suppressHeaderMenuButton: true,
}

// 클립보드 복사: Clipboard API 우선, 안 되면(http 내부망 · 권한 거부) 예전 방식으로
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      return await navigator.clipboard.writeText(text)
    } catch {
      /* 권한 거부 → 아래 대체 방법 */
    }
  }
  const prevFocus = document.activeElement
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  prevFocus?.focus?.({ preventScroll: true }) // 키보드로 계속 이동할 수 있게 셀 포커스 복원
  if (!ok) throw new Error('브라우저가 복사를 막았어요. 셀 글자를 드래그해서 복사해 주세요')
}

// 화면에 보이는 값(포맷 적용) 그대로
function displayValue(api, node, column) {
  const v = api.getCellValue({ rowNode: node, colKey: column, useFormatter: true })
  if (v instanceof Date) return v.toLocaleDateString('ko-KR')
  return v == null ? '' : String(v)
}

// 공통 그리드: 테마 · 한국어 · 기본 컬럼 설정 · 복사
//   Ctrl+C        선택한 셀 값 복사 (AG Grid Community 에는 클립보드 기능이 없어 직접 구현)
//   Ctrl+Shift+C  선택한 행 전체를 탭으로 구분해 복사 (엑셀에 그대로 붙여넣기)
//   마우스로 셀 글자를 드래그해서 복사도 가능
export function DataGrid({ gridRef, height = 560, onCellKeyDown, ...props }) {
  const dark = useDark()
  const notify = useToast()

  const handleKeyDown = useCallback(
    (e) => {
      onCellKeyDown?.(e)
      const k = e.event
      if (!k || !(k.ctrlKey || k.metaKey) || k.key?.toLowerCase() !== 'c') return
      if (window.getSelection()?.toString()) return // 드래그로 고른 글자는 브라우저가 복사
      if (e.api.getEditingCells().length) return // 편집 중에는 입력칸 기본 동작
      if (!e.node || !e.column) return

      let text
      if (k.shiftKey) {
        const cols = e.api.getAllDisplayedColumns().filter((c) => c.getColDef().headerName)
        text = cols.map((c) => displayValue(e.api, e.node, c).replace(/[\t\n]/g, ' ')).join('\t')
      } else {
        text = displayValue(e.api, e.node, e.column)
      }
      k.preventDefault()
      copyText(text)
        .then(() => {
          const short = text.length > 40 ? `${text.slice(0, 40)}…` : text
          notify(k.shiftKey ? `행 복사됨 (${text.split('\t').length}칸) · 엑셀에 붙여넣을 수 있어요` : `복사됨: ${short || '(빈 값)'}`, 'ok')
        })
        .catch((err) => notify(err.message))
    },
    [notify, onCellKeyDown],
  )

  return (
    <div className="grid-box" style={{ height }}>
      <AgGridReact
        ref={gridRef}
        theme={dark ? darkTheme : lightTheme}
        localeText={AG_GRID_LOCALE_KR}
        defaultColDef={defaultColDef}
        tooltipShowDelay={300}
        enableCellTextSelection
        ensureDomOrder
        onCellKeyDown={handleKeyDown}
        {...props}
      />
    </div>
  )
}
