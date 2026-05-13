/**
 * accounts domain — 회원 프로필 / 설정 / 알림 등 user-centric 기능.
 *
 * 핵심 user 레코드는 [[domains/auth/schema]] 의 `users` 에 있고,
 * 여기에는 부가 도메인 (사용자 설정, 차단/신고 등) 만 향후 추가.
 *
 * Stage 2 백로그:
 *   - user_settings (notification_email, theme_preference, locale)
 *   - user_blocks (차단한 유저)
 *   - reports (글/댓글/유저 신고)
 */
export {};
