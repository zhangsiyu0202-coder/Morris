"""Long, complex survey fixture for pressure-testing the interview engine.

Scenario: post-trial UX research for a hypothetical meal-delivery app
("速达外卖"). 4 sections × 5 questions = 20 questions covering every supported
question type. Mix of standard and deep probes so a realistic run takes 15+
minutes of model dialogue.

The shape mirrors what `editor → publish → /interview` builds at runtime:
- `LONG_SURVEY_DRAFT` is the SurveyDraft the researcher would author
- `LONG_RUNTIME_STUDY` is what the editor compiles for the agent
- `SCRIPTED_ANSWERS` is the deterministic-with-jitter fake-interviewee script

The harness consumes these three together.
"""
from __future__ import annotations

from agent.contracts import (
    InterviewRuntimeQuestion,
    InterviewRuntimeSection,
    InterviewRuntimeStudy,
    SurveyDraft,
    SurveyDraftQuestion,
    SurveyDraftSection,
)


SURVEY_ID = "long_pressure_survey"

LONG_SURVEY_DRAFT = SurveyDraft(
    title="速达外卖 7 天试用体验深度访谈",
    researchGoal=(
        "理解试用速达外卖 7 天后的用户在订餐决策、配送体验、商家选择、"
        "结账与售后五个环节的真实感受;识别决定他们是否长期使用的关键时刻。"
    ),
    targetAudience=(
        "过去 7 天内首次安装并使用速达外卖至少 3 次的城市白领,年龄 22-40 岁,"
        "工作日中午或晚上点外卖,对配送时长 / 商家选择敏感。"
    ),
    introScript=(
        "你好,感谢你参加这次访谈。接下来大约 15-20 分钟,我会和你聊一聊"
        "你最近一周用速达外卖的体验。没有标准答案,你怎么用就怎么讲;"
        "我会偶尔问一些追问,把细节聊透。准备好了我们就开始。"
    ),
    sections=[
        SurveyDraftSection(
            title="第一部分:首次接触与安装动机",
            objective="挖掘用户从听说到首单的决策路径,识别拉新关键节点",
            questions=[
                SurveyDraftQuestion(
                    questionType="open_ended",
                    questionText="你是怎么知道速达外卖这个 App 的?",
                    probeLevel="deep",
                    probeInstruction=(
                        "追问具体渠道(朋友推荐 / 广告 / 应用商店搜索 / 红包券),"
                        "以及当时第一反应是什么 — 是马上下单还是观望了几天。"
                    ),
                ),
                SurveyDraftQuestion(
                    questionType="single_choice",
                    questionText="你下载速达外卖时,最主要的动机是哪一个?",
                    options=[
                        "新人红包很有吸引力",
                        "朋友 / 同事强烈推荐",
                        "原来用的外卖 App 体验不好",
                        "速达上有别的平台没有的商家",
                        "纯粹好奇,试一下",
                    ],
                    probeLevel="standard",
                    probeInstruction="选了某项后追问:这个理由具体是什么样的场景?",
                ),
                SurveyDraftQuestion(
                    questionType="rating",
                    questionText="从 1 到 5 分,你给『App 安装到下第一单』这个过程的顺畅度打几分?",
                    options=["1 分", "2 分", "3 分", "4 分", "5 分"],
                    probeLevel="deep",
                    probeInstruction=(
                        "追问扣分的具体步骤(注册 / 授权定位 / 选地址 / 找菜),"
                        "或者满分的话,具体是哪个细节让你感到流畅。"
                    ),
                ),
                SurveyDraftQuestion(
                    questionType="multi_choice",
                    questionText=(
                        "首次下单前,你会主要看商家的哪些信息来做选择?(可多选)"
                    ),
                    options=[
                        "评分和评论数",
                        "配送时长预估",
                        "起送价和配送费",
                        "图片清晰度",
                        "店家距离",
                        "是否有大额优惠券",
                    ],
                    probeLevel="standard",
                    probeInstruction="多选后追问优先级:这几项里你最先看的是哪一个,最后看的是哪个?",
                ),
                SurveyDraftQuestion(
                    questionType="open_ended",
                    questionText="如果让你向同事一句话推荐速达外卖,你会怎么说?",
                    probeLevel="standard",
                    probeInstruction="如果对方只能记住一个卖点,会是哪一个?",
                ),
            ],
        ),
        SurveyDraftSection(
            title="第二部分:订单决策与商家选择",
            objective="揭示用户在浏览-加购-结算路径上的犹豫点和决策捷径",
            questions=[
                SurveyDraftQuestion(
                    questionType="open_ended",
                    questionText=(
                        "请你回忆最近一次中午点速达外卖的过程,从打开 App 到付款,"
                        "你是怎么一步步决定吃什么的?"
                    ),
                    probeLevel="deep",
                    probeInstruction=(
                        "追问关键决策点:你是先想吃什么再找商家,还是先看推荐再选?"
                        "如果有犹豫,具体在哪一步犹豫?最后是什么让你下决心?"
                    ),
                ),
                SurveyDraftQuestion(
                    questionType="ranking",
                    questionText="按你下单时的实际优先级,把下面 4 个因素排个序(从最重要到最不重要)",
                    options=[
                        "配送时长",
                        "口味 / 评价",
                        "总价(餐费 + 配送费 - 优惠)",
                        "餐厅距离",
                    ],
                    probeLevel="deep",
                    probeInstruction=(
                        "排完顺序后追问:排第一的那一项,具体到了什么数字 / 程度,"
                        "你会切到第二选择?这个阈值你心里有数吗?"
                    ),
                ),
                SurveyDraftQuestion(
                    questionType="single_choice",
                    questionText="你下单时,对配送时长最能容忍的上限是?",
                    options=[
                        "30 分钟以内",
                        "31 - 45 分钟",
                        "46 - 60 分钟",
                        "60 分钟以上也可以接受",
                    ],
                    probeLevel="standard",
                    probeInstruction="为什么是这个时长?如果超时,你会取消还是继续等?",
                ),
                SurveyDraftQuestion(
                    questionType="rating",
                    questionText="你对速达外卖商家覆盖的丰富程度打几分(1-5)?",
                    options=["1 分", "2 分", "3 分", "4 分", "5 分"],
                    probeLevel="standard",
                    probeInstruction="有没有哪类店家是你特别想点但速达上找不到的?",
                ),
                SurveyDraftQuestion(
                    questionType="open_ended",
                    questionText=(
                        "速达外卖的『推荐』那一栏,你觉得它推的菜,跟你想吃的契合吗?"
                    ),
                    probeLevel="deep",
                    probeInstruction=(
                        "追问命中过几次 / 完全不准的情况各占多少;它推得最好和最差的"
                        "分别是哪种类型的菜。"
                    ),
                ),
            ],
        ),
        SurveyDraftSection(
            title="第三部分:配送与到达体验",
            objective="把握从下单成功到拿到餐这段时间的情绪曲线和痛点",
            questions=[
                SurveyDraftQuestion(
                    questionType="rating",
                    questionText="过去一周,速达外卖配送时长的稳定性你打几分(1-5)?",
                    options=["1 分", "2 分", "3 分", "4 分", "5 分"],
                    probeLevel="deep",
                    probeInstruction=(
                        "追问极端情况:有没有最快 / 最慢的一次,具体多长时间;"
                        "你感觉哪类餐厅 / 哪个时段最不靠谱。"
                    ),
                ),
                SurveyDraftQuestion(
                    questionType="open_ended",
                    questionText=(
                        "等餐过程中,你最关心 App 给你的什么信息?能不能描述"
                        "一下你在等餐时的典型行为?"
                    ),
                    probeLevel="deep",
                    probeInstruction=(
                        "追问刷新地图频率 / 是否打开通知 / 会不会主动联系骑手;"
                        "如果显示『已送达』但你没收到,你的第一反应是什么。"
                    ),
                ),
                SurveyDraftQuestion(
                    questionType="multi_choice",
                    questionText="过去一周,你遇到过下面哪些配送问题?(可多选)",
                    options=[
                        "餐到了但凉了",
                        "送错地址 / 拿错单",
                        "骑手联系不到",
                        "比预估时间晚了 15 分钟以上",
                        "包装破损 / 洒漏",
                        "都没遇到",
                    ],
                    probeLevel="standard",
                    probeInstruction="选了具体某项后,追问那一次的处理过程和你的情绪反应。",
                ),
                SurveyDraftQuestion(
                    questionType="single_choice",
                    questionText="如果配送超时,你最希望平台主动做什么?",
                    options=[
                        "弹窗道歉 + 自动补一张优惠券",
                        "立即联系骑手并告诉我原因",
                        "什么都别做,我自己看进度就行",
                        "直接补现金 / 退一部分配送费",
                    ],
                    probeLevel="standard",
                    probeInstruction=(
                        "选某项后追问:这个动作如果晚发了 5 分钟,你还会满意吗?"
                    ),
                ),
                SurveyDraftQuestion(
                    questionType="open_ended",
                    questionText="你最近一次拿到餐的瞬间,心情是怎么样的?能描述一下吗?",
                    probeLevel="deep",
                    probeInstruction=(
                        "追问拿到餐之后第一件事做了什么 / 是否打开包装 / 是否拍照 / "
                        "如果不满意会不会立刻退回。"
                    ),
                ),
            ],
        ),
        SurveyDraftSection(
            title="第四部分:结账、客服与忠诚度",
            objective=(
                "评估付款顺畅度、售后客服触达效率,以及用户是否愿意把速达"
                "作为日常主力外卖 App。"
            ),
            questions=[
                SurveyDraftQuestion(
                    questionType="rating",
                    questionText="结账页面的清晰度你打几分(1-5)?",
                    options=["1 分", "2 分", "3 分", "4 分", "5 分"],
                    probeLevel="standard",
                    probeInstruction=(
                        "扣分的话具体是哪一栏不清楚:餐费 / 配送费 / 优惠券 / 打包费?"
                    ),
                ),
                SurveyDraftQuestion(
                    questionType="multi_choice",
                    questionText="过去 7 天里,你用过下面哪些速达的优惠形式?(可多选)",
                    options=[
                        "新人红包",
                        "满减券",
                        "免配送费",
                        "限时秒杀价",
                        "拼单",
                        "都没用过",
                    ],
                    probeLevel="standard",
                    probeInstruction="选某项后追问:这个优惠是否真的影响了你下单的决定。",
                ),
                SurveyDraftQuestion(
                    questionType="open_ended",
                    questionText="如果遇到问题需要找客服,你会怎么找?描述一下你最近一次的过程。",
                    probeLevel="deep",
                    probeInstruction=(
                        "追问入口是否好找(自助 / 在线客服 / 电话);"
                        "客服解决问题花了多久,中间有没有让你重复说一遍。"
                    ),
                ),
                SurveyDraftQuestion(
                    questionType="nps",
                    questionText=(
                        "在 0-10 分中,你向身边朋友推荐速达外卖的可能性有多大?"
                        "0 分 = 完全不会,10 分 = 一定会。"
                    ),
                    options=[
                        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
                    ],
                    probeLevel="deep",
                    probeInstruction=(
                        "追问理由:打 9-10 分,具体是哪个点让你愿意主动推荐;"
                        "打 0-6 分,什么改进会让你打到 9 分以上。"
                    ),
                ),
                SurveyDraftQuestion(
                    questionType="open_ended",
                    questionText=(
                        "试用 7 天后,你接下来会继续把速达当成主力外卖 App 吗?"
                        "为什么?"
                    ),
                    probeLevel="deep",
                    probeInstruction=(
                        "追问关键决定因素:如果原来用的 A 平台同时有同样商家"
                        "+ 同样价格,你会怎么选?切换成本是什么。"
                    ),
                ),
            ],
        ),
    ],
)


# ----------------------------------------------------------------------------
# Runtime study: what the editor compiles for the agent. Stable ids per section
# / question so the harness can reference them from the scripted-answer table.
# ----------------------------------------------------------------------------

_RESPONSE_MODE_BY_TYPE = {
    "open_ended": "voice_only",
    "single_choice": "single_select",
    "multi_choice": "multi_select",
    "rating": "scale",
    "nps": "scale",
    "ranking": "ranking",
}


def _compile_runtime_study(draft: SurveyDraft) -> InterviewRuntimeStudy:
    sections: list[InterviewRuntimeSection] = []
    for s_idx, draft_section in enumerate(draft.sections, start=1):
        section_id = f"sec_{s_idx}"
        runtime_questions: list[InterviewRuntimeQuestion] = []
        for q_idx, draft_question in enumerate(draft_section.questions, start=1):
            runtime_questions.append(
                InterviewRuntimeQuestion(
                    questionId=f"{section_id}_q{q_idx}",
                    sectionId=section_id,
                    sectionTitle=draft_section.title,
                    orderInSection=q_idx,
                    questionText=draft_question.questionText,
                    questionType=draft_question.questionType,
                    probeLevel=draft_question.probeLevel,
                    probeInstruction=draft_question.probeInstruction,
                    options=list(draft_question.options),
                    responseMode=_RESPONSE_MODE_BY_TYPE[draft_question.questionType],
                    stimulus=draft_question.stimulus,
                )
            )
        sections.append(
            InterviewRuntimeSection(
                sectionId=section_id,
                title=draft_section.title,
                objective=draft_section.objective,
                questions=runtime_questions,
            )
        )
    return InterviewRuntimeStudy(
        surveyId=SURVEY_ID,
        studyTitle=draft.title,
        researchGoal=draft.researchGoal,
        targetAudience=draft.targetAudience,
        introScript=draft.introScript,
        sections=sections,
    )


LONG_RUNTIME_STUDY = _compile_runtime_study(LONG_SURVEY_DRAFT)


def total_questions() -> int:
    return sum(len(s.questions) for s in LONG_RUNTIME_STUDY.sections)


def all_question_ids() -> list[str]:
    return [q.questionId for s in LONG_RUNTIME_STUDY.sections for q in s.questions]


# ----------------------------------------------------------------------------
# Scripted answers — the fake interviewee. Each entry has:
#   `main`:   first-pass response to the main question
#   `probes`: list of 5 follow-up answers used for whichever probe rounds the
#             model chooses to ask (deep/standard caps at 5/3 respectively).
# Multiple probes covered per question so the harness can keep responding even
# when the model goes off-script with its follow-ups.
# ----------------------------------------------------------------------------

SCRIPTED_ANSWERS: dict[str, dict[str, object]] = {
    # Section 1
    "sec_1_q1": {
        "main": (
            "其实是同事在午饭群里发的红包链接,我点开就装了。第一次没立刻下单,"
            "第二天看到外卖晚到,才想起速达上有家川菜评分挺高,就试了。"
        ),
        "probes": [
            "渠道就是公司微信群,大概十几个人在用,有人晒了一张满 30 减 18 的图。",
            "那张图我截屏了一下,正是因为减得多才记住的,不然刷过去就忘了。",
            "下载到下单中间隔了大概 24 小时,我一开始有点担心是新平台菜会不全。",
            "促使我下单的还是那个减 18,我心想试错成本低。",
            "印象里没看广告,主要是同事群和应用商店搜了一下评分。",
        ],
    },
    "sec_1_q2": {
        "main": "我选的是『新人红包很有吸引力』,因为减得比饿了么大很多。",
        "probes": [
            "新人红包是 18 元无门槛,饿了么我那阵子没新人券,所以差很大。",
            "如果没有红包,我多半就懒得装第二个外卖 App 了。",
            "红包用完之后我又点了 2 单,所以从拉新角度它确实有效果。",
            "我会向同事推这个新人红包,因为大家都怕踩雷,有红包就敢试。",
            "如果红包变成了 5 元,我大概率不会下载。",
        ],
    },
    "sec_1_q3": {
        "main": "我打 4 分。整体顺,但选地址那一步定位偏了一个园区。",
        "probes": [
            "扣分主要是定位不准,我得手动搜公司全名才能找到。",
            "授权定位的弹窗我点过『仅本次允许』,不知道是不是这个原因。",
            "下单流程倒是顺,加购到付款就 3 步。",
            "支付走的微信免密,这一步几乎没感觉。",
            "如果是 5 分,定位要么默认精确到楼层,要么记住上一次填的。",
        ],
    },
    "sec_1_q4": {
        "main": "评分和评论数、配送时长预估、起送价和配送费,这三项我必看。",
        "probes": [
            "最先看的是评分,低于 4.5 我基本不点。",
            "其次看配送时长,如果超过 40 分钟我会换。",
            "起送价和配送费放最后,因为加起来差不太多。",
            "图片我会扫一眼判断真实度,P 太厉害的反而扣分。",
            "店家距离我自己心里有数,3 公里外的基本不考虑。",
        ],
    },
    "sec_1_q5": {
        "main": "速达上同样的店常常便宜 5-10 块,新人红包还能再省一波。",
        "probes": [
            "我会突出『便宜 + 红包』这两点,白领最在意性价比。",
            "如果只能记一个,就是新人红包 18 元无门槛。",
        ],
    },
    # Section 2
    "sec_2_q1": {
        "main": (
            "中午 11 点 45 我打开 App,先扫推荐,看到一家牛肉饭排第一,但我那天"
            "想吃面,就搜『面』筛出附近 3 公里的。最后选了排第二的兰州牛肉面。"
        ),
        "probes": [
            "我先想吃什么再去搜,推荐基本是辅助。",
            "犹豫主要在『面』和『饭』之间,因为面凉得快。",
            "决定下单是因为那家面馆评分 4.7、配送时长 28 分钟,信号都到位。",
            "整个过程大概 6 分钟,主要时间花在翻评论确认是不是骨头汤底。",
            "如果配送时长超 35 分钟我就放弃了,中午时间太紧。",
        ],
    },
    "sec_2_q2": {
        "main": "我的优先级是配送时长 > 总价 > 口味 > 距离。",
        "probes": [
            "配送时长是底线,中午我只有 1 小时吃饭。",
            "总价超过 35 块我会换一家,日常预算心里有数。",
            "口味反而排第三,因为评分把我筛过一轮了。",
            "距离最后,因为距离已经体现在配送时长里。",
            "我切第二选择的阈值大概是配送时长 +10 分钟、总价 +8 块。",
        ],
    },
    "sec_2_q3": {
        "main": "31-45 分钟,这是我中午的容忍上限。",
        "probes": [
            "因为我中午饭点是 12:00 - 13:00,超过 13:00 就影响下午会议。",
            "如果显示要 50 分钟,我会取消重选,不会等。",
        ],
    },
    "sec_2_q4": {
        "main": "我打 3 分,商家总数够,但精品咖啡和小众面馆缺位。",
        "probes": [
            "缺的是公司楼下那家小众咖啡 manner,速达上找不到。",
            "如果能补上 manner / Seesaw / M Stand,我会更频繁地用速达。",
        ],
    },
    "sec_2_q5": {
        "main": "推荐栏命中率大概一半一半,周末晚上推得比较准,工作日午饭偏离。",
        "probes": [
            "周末推得准是因为它知道我之前点过烧烤、火锅,周末确实想吃这些。",
            "工作日午饭它老推甜食和咖啡,但我一般要正餐。",
            "推得最差的是早餐,推一些奶茶,跟我习惯不符。",
            "如果让我评,推荐应该按时段加权,工作日 11 点别推甜食。",
            "命中过最惊艳的一次是它推了一家新开的鸡丝凉面,我一直在找类似的。",
        ],
    },
    # Section 3
    "sec_3_q1": {
        "main": "稳定性我打 3 分。预估 30 分但实际经常 35-40,偶尔有快得离谱的 22 分钟。",
        "probes": [
            "最快一次是周二下午 2 点点的咖啡,22 分钟,因为店离公司近。",
            "最慢一次是周五晚高峰,预估 35 实际花了 58 分,超时了 23 分钟。",
            "中午 12 点 - 12:30 这个高峰段最不靠谱,经常多 10-15 分钟。",
            "我感觉商场里的连锁餐厅最准,街边小店波动大。",
            "如果能把波动方差降到 ±5 分钟,我立刻打 5 分。",
        ],
    },
    "sec_3_q2": {
        "main": (
            "我最关心骑手到哪里了 + 预估剩余时间。等餐时我一般会刷一会儿"
            "微信和小红书,大概每 5 分钟回 App 看一眼。"
        ),
        "probes": [
            "刷新地图大概 3-4 次,每次扫一眼骑手位置。",
            "通知是开的,骑手出餐和到店那两条最有用。",
            "主动联系骑手的频率不高,只有显示『送达』我没收到时才打。",
            "如果显示已送达但餐没到,我第一反应是查门卫和前台。",
            "等的过程中我容易刷新强迫症,看到时间一动我心情会好转一点。",
        ],
    },
    "sec_3_q3": {
        "main": "我遇到过『餐到了但凉了』和『比预估时间晚了 15 分钟以上』。",
        "probes": [
            "凉了那次是冬天,周末晚上,店家做得快但骑手等了别的单。",
            "晚 15 分钟那次平台没主动道歉,我比较失望。",
            "处理方式是我自己点了客服,补了一张 5 元券,情绪上没完全消。",
            "送错地址我没遇到,可能是因为我地址固定。",
            "破损洒漏一次都没,这点速达包装做得还可以。",
        ],
    },
    "sec_3_q4": {
        "main": "我最希望平台立即联系骑手并告诉我原因。",
        "probes": [
            "知道原因比赔钱更让我冷静,因为我在乎的是能不能吃上。",
            "如果晚了 5 分钟才发,我会觉得是事后补救而不是实时关怀。",
        ],
    },
    "sec_3_q5": {
        "main": "心情主要是松一口气,然后会快速看一眼包装是不是完整。",
        "probes": [
            "拿到第一件事是检查打包袋封条,有没有被撕过。",
            "我没有拍照习惯,除非是新店第一次点想发朋友圈。",
            "不满意的话我会先尝两口,确认问题再决定要不要走售后。",
            "送达的瞬间最爽的是周五晚上配速度比预估快,会觉得这周值了。",
            "也有过拿到发现汤洒了的时候,那种心情是『行吧,凑合吃』。",
        ],
    },
    # Section 4
    "sec_4_q1": {
        "main": "结账页清晰度打 4 分。各项费用列得分明,只是优惠券折后价不够醒目。",
        "probes": [
            "扣分主要是优惠券抵扣那一栏字号偏小,我得放大屏幕看。",
            "餐费 / 配送费 / 打包费各列一行没问题,清楚。",
            "如果折后价能用红色加大字号显示,我会打 5 分。",
        ],
    },
    "sec_4_q2": {
        "main": "我用过新人红包、满减券、免配送费三种。",
        "probes": [
            "新人红包是首单 18 元无门槛,直接降本。",
            "满减券是 30 减 8 类的,我会刻意凑单凑到 30 块。",
            "免配送费是周二会员日,我会专门挑这天点。",
            "限时秒杀价我没用过,因为限定的店不是我常吃的。",
            "拼单也没用过,公司里同事点的方向都不一样。",
        ],
    },
    "sec_4_q3": {
        "main": (
            "我会先点订单详情里的『申请售后』,如果选项不对再点在线客服。"
            "最近一次是配送超时,我点的在线客服。"
        ),
        "probes": [
            "入口算好找,订单页面左下角有醒目入口。",
            "在线客服先是机器人,我打了三轮才转人工。",
            "人工客服解决花了大概 8 分钟,中间让我重复了一次单号。",
            "她最后给我补了一张 5 元券,我接受了。",
            "整体体验中等,没有太惊喜,也没让我特别恼火。",
        ],
    },
    "sec_4_q4": {
        "main": "我打 7 分。",
        "probes": [
            "扣分主要是商家覆盖度还不够,精品咖啡缺位。",
            "如果精品咖啡和小众甜品店上线,我会打 9 分。",
            "新人红包我已经向 3 个同事推过,所以推荐意愿是真实的。",
            "如果速达把配送稳定性再提一档,8-9 分跑不了。",
            "现阶段不打 9 分以上,因为还没经历过『出问题平台帮我兜底』的高光时刻。",
        ],
    },
    "sec_4_q5": {
        "main": (
            "短期内我会继续把速达当主力,因为新人红包和满减券还没用完。"
            "长期看,如果商家覆盖追上来,我可能就稳定切换。"
        ),
        "probes": [
            "切换关键因素是商家全 + 配送稳定,这两个我看重。",
            "如果原来的 A 平台同样商家同价,我会留在我熟悉的 A 平台。",
            "切换成本主要是地址簿、付款方式、口味偏好这三块。",
            "速达让我打开新 App 的成本不高,因为微信免密支付一开就能用。",
            "总结一句话:试用结束我会继续用,但不会卸载 A 平台。",
        ],
    },
}
