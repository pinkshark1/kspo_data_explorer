# KSPO 데이터 탐색기

## 데이터 탐색기

### [**https://pinkshark1.github.io/kspo_data_explorer/**](https://pinkshark1.github.io/kspo_data_explorer/)

국민체육진흥공단(KSPO)이 보유·개방하고 있는 데이터 자산을 한눈에 확인하기 위한 웹 기반 데이터 탐색기입니다.

데이터 목록을 단순 조회하는 방식에서 벗어나 **검색·필터·카테고리·데이터 상세정보·데이터 간 연계관계** 등을 통해 필요한 데이터를 보다 쉽게 탐색할 수 있도록 구성하였습니다.

별도 프로그램 설치 없이 웹 브라우저에서 위 주소로 접속하여 사용할 수 있습니다.

---

## 주요 기능

| 구분            | 내용                                   |
| ------------- | ------------------------------------ |
| **데이터 검색**    | 데이터명과 주요 정보를 기준으로 필요한 데이터를 검색        |
| **카테고리 탐색**   | 체육·스포츠 관련 데이터를 분야별로 분류하여 탐색          |
| **데이터 필터**    | 데이터 출처, 제공 형태, 업데이트 주기 등 조건을 이용한 필터링 |
| **데이터 상세정보**  | 데이터 소개, 주요 내용 및 관련 정보를 한 화면에서 확인     |
| **데이터 관계도**   | 데이터 간 연계관계를 시각적으로 탐색                 |
| **데이터 출처 구분** | 공공데이터포털, 문화빅데이터플랫폼 등 데이터 제공·개방 출처 확인 |
| **웹 기반 이용**   | 별도 프로그램 설치 없이 브라우저에서 바로 이용           |

---

## 운영 구조

개발·관리는 **AI정부지원서비스 GitLab**에서 수행하고, 공개용 웹페이지는 **GitHub Pages**를 이용합니다.

```text
[원본 / 개발·관리]

AI정부지원서비스 GitLab
gitlab.aigov.go.kr
        │
        │ main 브랜치 Commit
        ▼
GitLab CI/CD
        │
        ▼
Project Runner
        │
        │ GitHub main 자동 동기화
        ▼
[공개용 미러]

GitHub
pinkshark1/kspo_data_explorer
        │
        │ GitHub Pages
        ▼
[웹 서비스]

https://pinkshark1.github.io/kspo_data_explorer/
```

### 저장소 역할

| 구분               | 주소                                               | 역할              |
| ---------------- | ------------------------------------------------ | --------------- |
| **GitLab**       | `gitlab.aigov.go.kr/doongju1/kspo_data_explorer` | 원본 소스 관리 및 수정   |
| **GitHub**       | `github.com/pinkshark1/kspo_data_explorer`       | 웹 공개를 위한 미러 저장소 |
| **GitHub Pages** | `pinkshark1.github.io/kspo_data_explorer/`       | 실제 데이터 탐색기 서비스  |

**GitLab을 원본(Source of Truth)으로 사용합니다.**

GitHub 저장소는 공개 배포를 위한 미러이므로 원칙적으로 GitHub에서 직접 파일을 수정하지 않습니다.

---

## 배포 방식

`main` 브랜치를 기준으로 배포합니다.

```text
1. GitLab에서 파일 수정
          ↓
2. main 브랜치 Commit
          ↓
3. GitLab Pipeline 자동 실행
          ↓
4. Project Runner가 작업 수행
          ↓
5. GitHub main 브랜치로 자동 동기화
          ↓
6. GitHub Pages 자동 배포
          ↓
7. 공개 URL에 변경사항 반영
```

따라서 정상적인 운영 시 **GitHub에 별도로 파일을 업로드하거나 GitHub Pages를 수동으로 갱신할 필요가 없습니다.**

---

## 저장소 구성

현재 데이터 탐색기는 브라우저에서 실행할 수 있는 정적 웹 콘텐츠를 중심으로 구성되어 있습니다.

```text
kspo_data_explorer/
│
├─ index.html
│   └─ 데이터 탐색기 메인 화면
│
├─ README.md
│   └─ 프로젝트 및 운영 방법 안내
│
└─ .gitlab-ci.yml
    └─ GitLab CI/CD 및 GitHub 자동 동기화 설정
```

구성 변경 시 GitHub Pages에서 사용하는 상대경로가 정상적으로 유지되는지 확인합니다.

---

## 운영 원칙

### GitLab에서만 원본 수정

```text
GitLab   = 원본
GitHub   = 공개용 미러
Pages    = 서비스 화면
```

GitHub에서 직접 수정할 경우 GitLab과 GitHub의 Commit 이력이 달라져 자동 동기화가 실패할 수 있습니다.

따라서 소스 수정은 반드시 **GitLab → main**을 기준으로 수행합니다.
---



## 개발 및 운영 기준

* 기본 브랜치: `main`
* 원본 저장소: GitLab
* 공개 미러: GitHub
* 웹 배포: GitHub Pages
* 배포 방식: GitLab CI/CD
* 실행 Runner: Project Runner
* 공개 URL: `https://pinkshark1.github.io/kspo_data_explorer/`

---

## 변경 관리

데이터 탐색기의 기능이나 데이터를 변경할 경우 가능하면 Commit 메시지에 변경내용을 명확하게 작성합니다.

예:

```text
데이터 카테고리 분류 개선
```

```text
데이터셋 검색 기능 수정
```

```text
데이터 관계도 UI 개선
```

```text
공공데이터포털 데이터 업데이트
```

```text
GitHub Pages 배포 설정 수정
```

이를 통해 변경 이력을 GitLab에서 추적할 수 있도록 합니다.

---

## 프로젝트 주소

### 원본 저장소

**GitLab**

`https://gitlab.aigov.go.kr/doongju1/kspo_data_explorer`

### 공개 미러

**GitHub**

`https://github.com/pinkshark1/kspo_data_explorer`

### 데이터 탐색기

**GitHub Pages**

### [**https://pinkshark1.github.io/kspo_data_explorer/**](https://pinkshark1.github.io/kspo_data_explorer/)

---

