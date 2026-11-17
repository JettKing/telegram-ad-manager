import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  FileImage,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Megaphone,
  PackageOpen,
  PanelLeftClose,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  X,
} from "lucide-react";
import type { HealthPayload, NavigationItem } from "@tg-ad-manager/contracts";
import { getHealth } from "./lib/api";

type NavIcon = typeof LayoutDashboard;

type NavEntry = NavigationItem & { icon: NavIcon };

const navigation: NavEntry[] = [
  { href: "/", label: "概览", description: "运营状态与待处理事项", group: "运营", icon: LayoutDashboard },
  { href: "/workspace", label: "工作空间", description: "组织团队与业务边界", group: "运营", icon: Store },
  { href: "/channels", label: "频道", description: "绑定频道与权限检查", group: "运营", icon: Radio },
  { href: "/customers", label: "客户", description: "客户关系与合作记录", group: "运营", icon: Users },
  { href: "/packages", label: "广告套餐", description: "报价、规则与权益", group: "运营", icon: PackageOpen },
  { href: "/orders", label: "广告订单", description: "审核、付款与履约", group: "运营", icon: Megaphone },
  { href: "/schedules", label: "排期日历", description: "计划发布与冲突检查", group: "运营", icon: CalendarDays },
  { href: "/media", label: "素材中心", description: "Telegram 媒体与归档", group: "运营", icon: FileImage },
  { href: "/publishes", label: "发布任务", description: "队列、结果与恢复", group: "运营", icon: Activity },
  { href: "/subscription", label: "会员订阅", description: "租户权益与额度", group: "系统", icon: CircleDollarSign },
];

const metricCards = [
  { label: "待处理订单", value: "暂无数据", hint: "连接真实订单后显示", icon: Megaphone },
  { label: "即将发布", value: "暂无数据", hint: "连接排期后显示", icon: CalendarDays },
  { label: "待核账款", value: "暂无数据", hint: "连接财务流水后显示", icon: CircleDollarSign },
  { label: "活跃频道", value: "暂无数据", hint: "完成频道绑定后显示", icon: Radio },
];

function App() {
  const [activePath, setActivePath] = useState(() => window.location.pathname || "/");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then((payload) => {
        if (payload.ok) {
          setHealth(payload.data);
          setHealthError(null);
        } else {
          setHealthError(payload.error.message);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHealthError("无法连接 API，请检查开发服务是否运行。");
      });
    return () => controller.abort();
  }, []);

  const current = useMemo(
    () => navigation.find((entry) => entry.href === activePath) ?? navigation[0],
    [activePath],
  );

  const choosePath = (href: string) => {
    window.history.pushState({}, "", href);
    setActivePath(href);
    setMobileOpen(false);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span>TG</span></div>
          <div>
            <div className="brand-name">TG Ad Manager</div>
            <div className="brand-caption">运营工作台 · V1.1</div>
          </div>
          <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="关闭导航"><X size={18} /></button>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">A</div>
          <div className="workspace-copy"><strong>默认工作空间</strong><span>待连接 Telegram</span></div>
          <ChevronRight size={16} className="muted-icon" />
        </div>

        <nav className="main-nav" aria-label="主导航">
          {(["运营", "系统"] as const).map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-label">{group}</div>
              {navigation.filter((entry) => entry.group === group).map((entry) => {
                const Icon = entry.icon;
                const isActive = current.href === entry.href;
                return <button key={entry.href} className={`nav-item ${isActive ? "active" : ""}`} onClick={() => choosePath(entry.href)}><Icon size={17} strokeWidth={isActive ? 2.4 : 1.8} /><span>{entry.label}</span>{isActive && <span className="active-pip" />}</button>;
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item muted"><Settings2 size={17} /><span>系统设置</span></button>
          <div className="operator-card"><div className="operator-avatar">O</div><div><strong>运营管理员</strong><span>权限待配置</span></div><ChevronRight size={15} className="muted-icon" /></div>
        </div>
      </aside>

      {mobileOpen && <button className="mobile-backdrop" onClick={() => setMobileOpen(false)} aria-label="关闭导航遮罩" />}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Menu size={20} /></button>
          <div className="breadcrumb"><span>运营工作台</span><ChevronRight size={15} /><strong>{current.label}</strong></div>
          <div className="topbar-actions"><div className="connection-pill"><span className={`status-dot ${health?.ok ? "online" : ""}`} />{health?.ok ? "本地 API 已连接" : "等待 API"}</div><button className="help-button"><LifeBuoy size={16} />帮助</button><div className="profile-chip">OP</div></div>
        </header>

        <div className="content-wrap">
          <section className="page-heading"><div><div className="eyebrow">{current.group} · 工作台</div><h1>{current.label}</h1><p>{current.description}</p></div><button className="secondary-button"><ShieldCheck size={16} />安全状态</button></section>

          {current.href === "/" ? <Overview health={health} healthError={healthError} onNavigate={choosePath} /> : <ModulePlaceholder entry={current} />}
        </div>
      </main>
    </div>
  );
}

function Overview({ health, healthError, onNavigate }: { health: HealthPayload | null; healthError: string | null; onNavigate: (href: string) => void }) {
  return <>
    <section className="status-banner"><div className="status-icon"><Sparkles size={19} /></div><div className="status-message"><strong>先建立可信的运营底座</strong><span>完成 Telegram Bot 与频道授权后，这里会展示真实订单、排期和发布任务。</span></div><button className="text-button" onClick={() => onNavigate("/channels")}>去绑定频道<ArrowUpRight size={15} /></button></section>

    <section className="metric-grid">{metricCards.map((metric) => { const Icon = metric.icon; return <article className="metric-card" key={metric.label}><div className="metric-icon"><Icon size={18} /></div><div className="metric-label">{metric.label}</div><div className="metric-value">{metric.value}</div><div className="metric-hint">{metric.hint}</div></article>; })}</section>

    <section className="dashboard-grid">
      <article className="panel next-panel"><div className="panel-heading"><div><div className="panel-kicker">Next step</div><h2>完成你的第一个业务闭环</h2></div><span className="neutral-chip">基础工程已就绪</span></div><div className="step-list"><Step index="01" title="配置 Telegram Bot" description="设置 Token 与 Webhook Secret，服务端不会把密钥返回前端。" state="待配置" /><Step index="02" title="绑定一个测试频道" description="由 Bot 检查频道身份和发布、置顶、删除权限。" state="待授权" /><Step index="03" title="创建一笔广告订单" description="使用真实客户、套餐和付款记录进入审核与排期流程。" state="待接入" /></div></article>
      <article className="panel runtime-panel"><div className="panel-heading"><div><div className="panel-kicker">Runtime</div><h2>运行状态</h2></div><Activity size={18} className="panel-icon" /></div><div className="runtime-list"><RuntimeRow label="API 服务" state={health?.ok ? "正常" : "等待"} tone={health?.ok ? "good" : "neutral"} /><RuntimeRow label="数据库" state={health?.dependencies.database === "configured" ? "已连接" : "待配置"} tone={health?.dependencies.database === "configured" ? "good" : "neutral"} /><RuntimeRow label="Telegram Bot" state={health?.dependencies.telegram === "configured" ? "已配置" : "待配置"} tone={health?.dependencies.telegram === "configured" ? "good" : "neutral"} /><RuntimeRow label="R2 归档" state={health?.dependencies.r2 === "configured" ? "已启用" : "可选"} tone={health?.dependencies.r2 === "configured" ? "good" : "neutral"} /></div>{healthError ? <div className="inline-error">{healthError}</div> : <div className="runtime-footnote">探针时间：{health ? new Date(health.timestamp).toLocaleTimeString("zh-CN") : "等待响应"}</div>}</article>
    </section>

    <section className="lower-grid"><article className="panel empty-panel"><div className="empty-icon"><BarChart3 size={20} /></div><h2>还没有运营数据</h2><p>连接真实频道并完成第一笔订单后，系统会从数据库生成统计，不会使用固定演示数字。</p><button className="secondary-button" onClick={() => onNavigate("/workspace")}>查看工作空间<ChevronRight size={15} /></button></article><article className="panel compliance-panel"><div className="panel-heading"><div><div className="panel-kicker">Guardrails</div><h2>业务安全边界</h2></div><CheckCircle2 size={18} className="check-icon" /></div><p>租户隔离、权限控制、审计记录和任务幂等是核心流程的前置条件。每个外部联调项都会保留可验证状态。</p><div className="tag-row"><span>多租户隔离</span><span>可审计</span><span>可恢复</span></div></article></section>
  </>;
}

function Step({ index, title, description, state }: { index: string; title: string; description: string; state: string }) { return <div className="step-row"><div className="step-index">{index}</div><div className="step-copy"><strong>{title}</strong><span>{description}</span></div><span className="neutral-chip">{state}</span></div>; }
function RuntimeRow({ label, state, tone }: { label: string; state: string; tone: "good" | "neutral" }) { return <div className="runtime-row"><span>{label}</span><span className={`state-chip ${tone}`}><span className="mini-dot" />{state}</span></div>; }
function ModulePlaceholder({ entry }: { entry: NavEntry }) { return <section className="module-placeholder panel"><div className="placeholder-orbit"><entry.icon size={24} /></div><div className="panel-kicker">Module foundation</div><h2>{entry.label}即将接入真实业务</h2><p>当前页面只展示模块边界和状态，不使用固定订单、客户、收入或发布数据。接入对应 Migration、API、权限和测试后，这里才会呈现可操作内容。</p><div className="placeholder-points"><div><ShieldCheck size={16} /><span>后端权限校验</span></div><div><Activity size={16} /><span>操作状态反馈</span></div><div><LifeBuoy size={16} /><span>失败恢复入口</span></div></div></section>; }

export default App;
