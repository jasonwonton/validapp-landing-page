import { expect, test } from '@playwright/test';

test('feed sender labels match native grade, emoji, reveal and privacy precedence', async ({ page }) => {
    await page.goto('/app/?signin=1');
    const labels = await page.evaluate(async () => {
        const { feedVoterLine, tbhSenderLine, senderGrade, senderGradeIsSafe } = await import('/app/feed-sender.js');
        const item = { voter_gender: 'female', voter_grade: 'Sophomore (C/O 2029)', voter_first_letter_hint: 'maya' };
        return {
            girl: feedVoterLine(item, { safeGrade: true }),
            boy: feedVoterLine({ voter_gender: 'male', voter_grade: '8th Grade' }, { safeGrade: true }),
            person: feedVoterLine({ voter_gender: 'non-binary', voter_grade: 'Grade 12' }, { safeGrade: true }),
            hint: feedVoterLine(item, { personal: true, subscriber: true }),
            hidden: feedVoterLine(item),
            missingGender: feedVoterLine({ voter_grade: 'Senior' }, { safeGrade: true }),
            noInferredGrade: feedVoterLine({ voter_gender: 'female' }, { personal: true, subscriber: true }),
            revealed: feedVoterLine({ ...item, voter_name: 'Maya Chen' }, { personal: true }),
            schoolRevealed: feedVoterLine({ ...item, voter_name: 'Maya Chen' }),
            own: feedVoterLine({ ...item, current_user_voted: true, voter_name: 'Other' }, { personal: true, currentName: 'Jules Rivera' }),
            schoolOwn: feedVoterLine({ current_user_voted: true }, { currentName: 'Jules Rivera' }),
            tbh: tbhSenderLine({ author_gender: 'nonbinary', author_grade: '8' }, { safeGrade: true }),
            tbhHidden: tbhSenderLine({ author_gender: 'boy', author_grade: 'Senior' }),
            tbhMissing: tbhSenderLine({ author_gender: 'girl' }),
            grades: ['6', '7th Grade', 'Grade 8', '9', '10th', 'Junior (C/O 2028)', 'Grade 12'].map(senderGrade),
            safeAliases: senderGradeIsSafe('Sophomore', [{ user_id: 'one', grade: 'Grade 10' }, { user_id: 'two', grade: '10th (2029)' }]),
            duplicateNotSafe: senderGradeIsSafe('Sophomore', [{ user_id: 'one', grade: '10' }, { user_id: 'one', grade: 'Sophomore' }]),
            missingNotSafe: senderGradeIsSafe('Senior', []),
        };
    });
    expect(labels).toEqual({
        girl: 'from a 👧💗 Sophomore', boy: 'from an 👦💙 8th grader', person: 'from a 🧑💛 Senior',
        hint: 'from a 👧💗 Sophomore (M)', hidden: 'from a 👧💗 (grade hidden until more classmates join)',
        missingGender: '', noInferredGrade: 'from a 👧💗 (grade hidden until more classmates join)',
        revealed: 'by Maya Chen', schoolRevealed: 'from Maya Chen', own: 'from Jules Rivera', schoolOwn: 'from Jules Rivera (you 🫵)',
        tbh: 'from an 8th grader 🧑💛', tbhHidden: 'from a classmate 👦💙 (grade hidden until more classmates join)',
        tbhMissing: 'from a classmate 👧💗', grades: ['6th grader', '7th grader', '8th grader', 'Freshman', 'Sophomore', 'Junior', 'Senior'],
        safeAliases: true, duplicateNotSafe: false, missingNotSafe: false,
    });
});

for (const theme of ['light', 'dark']) {
    test(`${theme} compact sender line renders the native product emoji without clipping`, async ({ page }) => {
        await page.setViewportSize({ width: 393, height: 852 });
        await page.goto('/app/?demo=1&signin=1&godmode=1');
        await page.getByRole('button', { name: /^sign in$/i }).click();
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        const line = page.locator('[data-feed-detail="9001"] .feed-answer');
        await expect(line).toHaveText('from a 👧💗 Sophomore (M)');
        await expect(line).toHaveCSS('font-size', '12px');
        // Sign-in slides the panel in from the right. Measure the settled layout,
        // not a frame mid-transition (Linux WebKit reaches this assertion earlier).
        await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all([...document.querySelectorAll('#appView > .panel:not(.hidden)')]
                .flatMap(panel => panel.getAnimations())
                .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
                .map(animation => animation.finished.catch(() => {})));
        });
        expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })))
            .toEqual({ width: 393, viewport: 393 });
        const sizes = await line.evaluate(el => ({ width: el.getBoundingClientRect().width, parent: el.parentElement.getBoundingClientRect().width }));
        expect(sizes.width).toBeLessThanOrEqual(sizes.parent + 1);
    });
}
