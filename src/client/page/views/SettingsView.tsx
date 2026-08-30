/**
 * SettingsView —— 设置 + 表单（mock）。
 *
 * 3 个子块：
 *   1. 偏好（主题 / 语言 / 紧凑布局）
 *   2. 通知（4 个 toggle）
 *   3. 个人信息（只读 mock）
 *
 * 所有表单都是 mock：change 不写回任何存储，点击「保存」仅 console.info
 * + alert（与 QuickActions 一致行为）。目的是呈现「设置面板」视觉形态。
 */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './views.module.css'

export interface SettingsViewProps {
  t: PropsLocale<'hello'>['t']
}

interface Profile {
  name: string
  employeeId: string
  joinedAt: string
  team: string
  role: string
  email: string
}

/** 演示个人信息 —— 只读。 */
const PROFILE: Profile = {
  name: '小李',
  employeeId: 'DS-2024-0089',
  joinedAt: '2024-03-12',
  team: '客户端 · 工作台组',
  role: 'Tech Lead',
  email: 'xiaoli@example.com',
}

export function SettingsView({ t }: SettingsViewProps): JSX.Element {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const [compact, setCompact] = useState(false)
  const [bugAlert, setBugAlert] = useState(true)
  const [mrReview, setMrReview] = useState(true)
  const [mention, setMention] = useState(true)
  const [weeklyDigest, setWeeklyDigest] = useState(false)

  const onSave = (): void => {
    console.info('[dsh-hello] mock settings save', {
      theme, language, compact, bugAlert, mrReview, mention, weeklyDigest,
    })
    if (typeof window !== 'undefined') {
      window.alert(t('view.settings.saveToast'))
    }
  }

  return (
    <div className={css.view}>
      <header className={css.viewHeader}>
        <h2 className={css.viewTitle}>{t('view.settings.title')}</h2>
        <p className={css.viewSubtitle}>{t('view.settings.subtitle')}</p>
      </header>

      {/* 子块 1：偏好 */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.settings.preference.title')}</h3>

        <div className={css.fieldRow}>
          <div className={css.fieldLabel}>
            {t('view.settings.preference.theme')}
          </div>
          <div className={css.fieldControl}>
            <select
              className={css.select}
              value={theme}
              onChange={(e) => { setTheme(e.target.value === 'dark' ? 'dark' : 'light') }}
              aria-label={t('view.settings.preference.theme')}
            >
              <option value="light">{t('view.settings.preference.themeLight')}</option>
              <option value="dark">{t('view.settings.preference.themeDark')}</option>
            </select>
          </div>
        </div>

        <div className={css.fieldRow}>
          <div className={css.fieldLabel}>
            {t('view.settings.preference.language')}
          </div>
          <div className={css.fieldControl}>
            <select
              className={css.select}
              value={language}
              onChange={(e) => { setLanguage(e.target.value === 'en' ? 'en' : 'zh') }}
              aria-label={t('view.settings.preference.language')}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <div className={css.fieldRow}>
          <div className={css.fieldLabel}>
            {t('view.settings.preference.compactDensity')}
          </div>
          <div className={css.fieldControl}>
            <Toggle checked={compact} onChange={setCompact} ariaLabel={t('view.settings.preference.compactDensity')} />
          </div>
        </div>
      </section>

      {/* 子块 2：通知 */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.settings.notifications.title')}</h3>

        <div className={css.fieldRow}>
          <div className={css.fieldLabel}>{t('view.settings.notifications.bugAlert')}</div>
          <div className={css.fieldControl}>
            <Toggle checked={bugAlert} onChange={setBugAlert} ariaLabel={t('view.settings.notifications.bugAlert')} />
          </div>
        </div>

        <div className={css.fieldRow}>
          <div className={css.fieldLabel}>{t('view.settings.notifications.mrReview')}</div>
          <div className={css.fieldControl}>
            <Toggle checked={mrReview} onChange={setMrReview} ariaLabel={t('view.settings.notifications.mrReview')} />
          </div>
        </div>

        <div className={css.fieldRow}>
          <div className={css.fieldLabel}>{t('view.settings.notifications.mention')}</div>
          <div className={css.fieldControl}>
            <Toggle checked={mention} onChange={setMention} ariaLabel={t('view.settings.notifications.mention')} />
          </div>
        </div>

        <div className={css.fieldRow}>
          <div className={css.fieldLabel}>{t('view.settings.notifications.weeklyDigest')}</div>
          <div className={css.fieldControl}>
            <Toggle checked={weeklyDigest} onChange={setWeeklyDigest} ariaLabel={t('view.settings.notifications.weeklyDigest')} />
          </div>
        </div>
      </section>

      {/* 子块 3：个人信息（只读） */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.settings.profile.title')}</h3>
        <ProfileRow label={t('view.settings.profile.name')}        value={PROFILE.name} />
        <ProfileRow label={t('view.settings.profile.employeeId')}  value={PROFILE.employeeId} />
        <ProfileRow label={t('view.settings.profile.joinedAt')}   value={PROFILE.joinedAt} />
        <ProfileRow label={t('view.settings.profile.team')}        value={PROFILE.team} />
        <ProfileRow label={t('view.settings.profile.role')}        value={PROFILE.role} />
        <ProfileRow label={t('view.settings.profile.email')}       value={PROFILE.email} />
      </section>

      <div className={css.row} style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className={css.saveButton}
          onClick={onSave}
        >
          {t('view.settings.save')}
        </button>
      </div>
    </div>
  )
}

function ProfileRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={css.fieldRow}>
      <div className={css.fieldLabel}>{label}</div>
      <div className={css.fieldControl} style={{ color: 'var(--dsw-alias-label-primary)' }}>
        {value}
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel: string }): JSX.Element {
  return (
    <label className={css.toggle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => { onChange(e.target.checked) }}
        aria-label={ariaLabel}
      />
      <span className={css.toggleSlider} />
    </label>
  )
}
