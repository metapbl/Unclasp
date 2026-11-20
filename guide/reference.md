# Unclasp 참고 자료

README 에서 다루지 않는 설정 데이터와 문제 해결 방법입니다. 쓰는 법은 [README](../README.md)를 보십시오.

## 설정 데이터

### 1. 스키마

chrome.storage.local 에 사이트 설정을 호스트별 항목으로 나눠 저장합니다. v1.17.0 까지는
chrome.storage.sync 에 두었고, 새 버전을 처음 실행할 때 local 이 비어 있으면 sync 의 설정을
그대로 복사합니다. sync 쪽은 지우지 않으므로 옛 버전으로 되돌려도 설정이 남아 있습니다.
복사가 실패하면 옵션 페이지 용량 줄에 오류가 보이고 브라우저를 다시 시작할 때 다시 시도합니다.
v1.7 이하가 쓰던 `sites` 한 항목에 모든 사이트를 넣는 옛 형식은 v1.18.0 부터 읽지도 지우지도
않습니다. 백업 파일의 `sites` 묶음은 지금 형식이므로 그대로 복구됩니다.

    {
      "global": { "adblock": true, "banner": true, "rightclick": false, "copy": false, "back": true },
      "s:example.com": {
        "rightclick": true,
        "selectors": ["#promo", ".ad-wrap"],
        "texts": [
          { "scope": "div", "word": "광고", "not": ["광고문의"] },
          { "scope": "div", "word": "특가", "m": "eq" }
        ]
      },
      "s:news.naver.com": { "nb": true, "selectors": [".gnb_banner"] },
      "schema": 2
    }

해석 규칙은 `site?.feature ?? global[feature]` 입니다. 사이트 항목의 필드는 이렇습니다.

- adblock / banner / rightclick / copy / back : 전역 기본값을 덮어쓰는 3-state 오버라이드. adblock(광고 차단)은 전역값에 이 키가 없으면 기본값 ON 을 따릅니다
- selectors : 직접 지정한 CSS 선택자 목록
- texts : 텍스트 규칙 목록. `{ scope, word }` 에 일치 방식 `m` 은 `"eq"`(완전 일치)나
  `"re"`(정규식)이고 포함이면 키가 없습니다. 제외 단어가 있으면 `not` 배열이 붙습니다. 제외 단어가 없는 규칙에는 `not` 키 자체가 없습니다
- nb : 기본 규칙 끔. true 면 이 사이트에서 내장 기본 선택자를 쓰지 않습니다
- ex : 기본 규칙 예외. 기본 선택자에만 적용되고 직접 지정한 선택자에는 적용되지 않습니다

필드가 저장되는 순서는 만들어진 경로에 따라 다를 수 있습니다. 값이 같으면 순서가 달라도
같은 설정으로 봅니다.

사이트 항목에 플래그도 selectors 도 texts 도 nb 도 ex 도 없으면 `s:<host>` 키 자체가
제거됩니다. 플래그는 true/false 일 때만, nb 는 true 일 때만, 목록은 실제 내용이 있을
때만 "있다" 고 봅니다. texts 는 word 가 실제로 있는 규칙이 하나라도 있어야 하므로,
제외 단어만 남은 항목은 내용으로 보지 않습니다. 빈 목록이나 `nb: false` 만 남은 항목은
그 사이트를 다시 저장할 때 정리됩니다.

진단 모드는 chrome.storage.session 에 저장되므로 탭을 닫거나 브라우저를 닫으면
사라집니다.

### 2. 백업과 복구

옵션 페이지의 "백업과 복구" 에서 파일로 주고받습니다.

"파일로 저장" 을 누르면 현재 설정 전체가 `settings-backup-2026-09-16.json` 처럼 날짜가
붙은 파일로 내려받아집니다. 내용은 `{ schema, global, sites }` 형태이고 사람이 읽을 수
있게 들여쓰기돼 있습니다.

"파일에서 복구" 는 고른 파일의 내용으로 지금 설정을 교체합니다. 합치지 않습니다. 바꾸기
전에 사이트가 몇 개 추가·교체·삭제되는지, 어떤 사이트가 사라지는지 확인 창으로 알려주므로
그 자리에서 취소할 수 있습니다. v1.7.x 에서 만든 백업 파일도 그대로 복구됩니다. 알 수
없는 필드나 형식이 맞지 않는 항목은 조용히 버립니다.

같은 파일을 그대로 다시 복구하면 확인 창에 "사이트 설정 변경 없음" 이라고 나옵니다.

설정을 직접 고치고 싶으면 파일로 저장한 뒤 편집기에서 수정하고 다시 복구하십시오.
텍스트 규칙의 `not` 은 배열이 정석이지만 문자열 하나만 적어도 받아들이고, 낱말과 같은
글자나 빈 값은 버립니다.

### 3. 용량

storage.local 의 한도는 전체 10MB(10,485,760바이트)이고 항목당·항목 수 한도는 없습니다.
sync 시절의 100KB·항목당 8KB·512개 한도는 더 이상 적용되지 않습니다. 백업 파일은 1MB 까지
복구할 수 있습니다. 한도를 넘으면 저장 실패를 화면에 알립니다. 규칙을 줄이거나 필요 없는
사이트를 지우십시오.

현재 사용량(예: `2.6KB / 10MB 사용 (1% 미만)`)과 사이트 개수는 옵션 페이지의 "백업과 복구"
카드 아래에서 봅니다. 한글은 UTF-8 에서 글자당 3바이트입니다. http/https 가 아닌 페이지에서는 사이트
항목을 만들지 않고 전역 기본값만 편집됩니다.

## 문제 해결

### 1. 저장된 값 보기

서비스 워커 콘솔(chrome://extensions → Unclasp → 서비스 워커)에서 실행합니다. Firefox·토르는
about:debugging#/runtime/this-firefox → Unclasp → "검사" 의 콘솔입니다.

    chrome.storage.local.get(null, a => console.log(Object.keys(a)))
    chrome.storage.local.get(null, a => console.log(JSON.stringify(a, null, 2)))
    chrome.storage.local.getBytesInUse(null, n => console.log(n))

텍스트 규칙이 등록되지 않은 것 같을 때도 여기서 확인합니다. 페이지 콘솔에서는
`chrome.storage` 를 쓸 수 없습니다. 콘텐츠 스크립트가 격리된 환경에서 돌기 때문에
페이지 콘솔에 입력한 코드에는 그 API 가 없습니다. 한 사이트만 보려면 키를 지정하십시오.

    chrome.storage.local.get("s:example.com", o => console.log(JSON.stringify(o, null, 2)))

진단 모드의 켜짐 상태는 session 에 탭별로 들어갑니다. 단축키가 안 먹는 것 같으면 같은
콘솔에서 아래로 확인하십시오. `diag:<tabId>` 키가 없으면 단축키 자체가 배경으로 가지
않은 것이고, 키가 true 인데 화면이 반응하지 않으면 그 탭의 콘텐츠 스크립트가 배경의 알림을
받지 못한 것입니다. 새로 고치거나 다른 주소로 이동하면 진단은 꺼집니다.

    chrome.storage.session.get(null, a => console.log(a))

### 2. 숨긴 규칙 찾기

진단 모드의 배지로 확인하십시오. 평소(진단·선택기를 쓰지 않는 동안)의 숨김 규칙은 페이지가
확장을 알아채지 못하도록 페이지 DOM 에 `<style>` 이나 클래스를 남기지 않습니다. Firefox·토르는
사용자 스타일시트로 넣어 페이지 콘솔에서 보이지 않고, Chrome 은 `document.adoptedStyleSheets`
에 넣어 콘솔에서 규칙 글자를 읽을 수 있습니다. 텍스트 규칙과 빈 컨테이너 접기는 요소의 자리를
가리키는 선택자(`:root>*:nth-child(2)>…`)로 들어갑니다. 요소가 안 보이게 된 것 자체는 페이지가
알아챌 수 있습니다.

텍스트 규칙이 잡을 것 같은데 잡지 않는 경우에는 페이지 콘솔에서 걸러내기 조건을 직접
확인할 수 있습니다. 포함 방식 기준이고, `div` 와 `광고` 자리에 그 규칙의 범위와 낱말을
넣으십시오.

    for (const el of document.querySelectorAll("div")) {
      const t = el.textContent || "", low = t.toLowerCase();
      const r = el.getBoundingClientRect();
      if (!low.includes("광고")) continue;
      console.log(el, {
        len: t.length,                                  // 200 초과면 제외
        skipUp: !!el.closest("nav, footer"),            // 조상 메뉴·푸터
        skipDown: !!el.querySelector("nav, footer"),    // 자손 메뉴·푸터
        w: r.width, h: r.height                         // 80 / 30 미달이면 제외
      });
    }

### 3. 설정 되돌리기

특정 사이트 항목만 지우려면 서비스 워커 콘솔에서
`chrome.storage.local.remove("s:example.com")` 을 실행합니다. 설정 전체를 되돌리려면
옵션 페이지에서 백업 파일로 복구하십시오.
