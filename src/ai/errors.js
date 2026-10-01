// 질문 검색(AI 호출)에서 이용자에게 보여줄 오류. code 로 종류를 구분한다.
//   key 인증 | rate 한도 | network 연결 | refusal 거절 | format 모델 응답 형식 | server 서버 | cancelled 취소 | bad_request 잘못된 요청(중계 서버)
export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}
