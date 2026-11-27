/*
 * unity.h - tiny Unity-compatible shim for running firmware/test/test_native
 * on a host without PlatformIO (e.g. with `python -m ziglang cc`).
 * Only the subset of the Unity API used by the HearMe tests is provided.
 * Kept in firmware/tools/unity_shim/ so it never shadows the real Unity under pio.
 */
#ifndef HEARME_UNITY_SHIM_H
#define HEARME_UNITY_SHIM_H

#include <setjmp.h>
#include <stdio.h>
#include <string.h>

void setUp(void);
void tearDown(void);

static int unity_tests, unity_failures, unity_cur_failed;
static jmp_buf unity_jmp;

#define UNITY_FAIL_AT(line, ...) do { \
    printf("%s:%d:FAIL: ", __FILE__, (int)(line)); printf(__VA_ARGS__); printf("\n"); \
    unity_cur_failed = 1; longjmp(unity_jmp, 1); } while (0)

#define UNITY_BEGIN() (unity_tests = 0, unity_failures = 0, 0)
#define UNITY_END() (printf("\n-----------------------\n%d Tests %d Failures 0 Ignored\n%s\n", \
    unity_tests, unity_failures, unity_failures ? "FAIL" : "OK"), unity_failures)

#define RUN_TEST(fn) do { \
    unity_tests++; unity_cur_failed = 0; \
    if (setjmp(unity_jmp) == 0) { setUp(); fn(); } \
    tearDown(); \
    if (unity_cur_failed) unity_failures++; \
    else printf("%s:%d:%s:PASS\n", __FILE__, __LINE__, #fn); } while (0)

#define TEST_MESSAGE(m) printf("%s:%d:INFO: %s\n", __FILE__, __LINE__, (m))
#define TEST_FAIL_MESSAGE(m) UNITY_FAIL_AT(__LINE__, "%s", (m))
#define TEST_ASSERT_TRUE_MESSAGE(c, m) do { if (!(c)) UNITY_FAIL_AT(__LINE__, "%s (%s)", #c, (m)); } while (0)
#define TEST_ASSERT_TRUE(c) do { if (!(c)) UNITY_FAIL_AT(__LINE__, "Expected TRUE: %s", #c); } while (0)
#define TEST_ASSERT_FALSE(c) do { if (c) UNITY_FAIL_AT(__LINE__, "Expected FALSE: %s", #c); } while (0)
#define TEST_ASSERT(c) TEST_ASSERT_TRUE(c)
#define TEST_ASSERT_NOT_NULL(p) do { if ((p) == NULL) UNITY_FAIL_AT(__LINE__, "Expected non-NULL: %s", #p); } while (0)
#define TEST_ASSERT_EQUAL_INT(e, a) do { long long e_ = (long long)(e), a_ = (long long)(a); \
    if (e_ != a_) UNITY_FAIL_AT(__LINE__, "Expected %lld Was %lld (%s)", e_, a_, #a); } while (0)
#define TEST_ASSERT_EQUAL(e, a) TEST_ASSERT_EQUAL_INT(e, a)
#define TEST_ASSERT_EQUAL_INT_MESSAGE(e, a, m) do { long long e_ = (long long)(e), a_ = (long long)(a); \
    if (e_ != a_) UNITY_FAIL_AT(__LINE__, "Expected %lld Was %lld (%s)", e_, a_, (m)); } while (0)
#define TEST_ASSERT_EQUAL_STRING(e, a) do { const char *e_ = (e), *a_ = (a); \
    if (strcmp(e_, a_) != 0) UNITY_FAIL_AT(__LINE__, "Expected \"%s\" Was \"%s\"", e_, a_); } while (0)
#define TEST_ASSERT_EQUAL_STRING_MESSAGE(e, a, m) do { const char *e_ = (e), *a_ = (a); \
    if (strcmp(e_, a_) != 0) UNITY_FAIL_AT(__LINE__, "Expected \"%s\" Was \"%s\" (%s)", e_, a_, (m)); } while (0)
#define TEST_ASSERT_EQUAL_MEMORY(e, a, n) do { \
    if (memcmp((e), (a), (n)) != 0) UNITY_FAIL_AT(__LINE__, "Memory mismatch (%s)", #a); } while (0)
#define TEST_ASSERT_EQUAL_MEMORY_MESSAGE(e, a, n, m) do { \
    if (memcmp((e), (a), (n)) != 0) UNITY_FAIL_AT(__LINE__, "Memory mismatch (%s)", (m)); } while (0)
#define TEST_ASSERT_DOUBLE_WITHIN(d, e, a) do { double d_ = (d), e_ = (e), a_ = (a); \
    if (a_ < e_ - d_ || a_ > e_ + d_) UNITY_FAIL_AT(__LINE__, "Expected %g +- %g Was %g", e_, d_, a_); } while (0)
#define TEST_ASSERT_GREATER_THAN(th, a) do { long long t_ = (long long)(th), a_ = (long long)(a); \
    if (!(a_ > t_)) UNITY_FAIL_AT(__LINE__, "Expected > %lld Was %lld", t_, a_); } while (0)

#endif
