// 게임 밸런스 상수. 시간 단위는 모두 "게임 분"(1분 = 1스텝)이다.

export const GAME_TITLE = '도트몬';
export const SAVE_VERSION = 1;

export const LCD_W = 48;
export const LCD_H = 24;

export const STAGE_ORDER = ['egg', 'baby', 'child', 'rookie', 'champion', 'ultimate'];

export const STAGE_LABEL = {
  egg: '알',
  baby: '유아기',
  child: '유년기',
  rookie: '성장기',
  champion: '성숙기',
  ultimate: '완전체',
};

// 단계별 기본값. 종(species)마다 덮어쓸 수 있다.
// duration: 다음 단계로 진화하기까지 걸리는 시간
// hungerEvery / strengthEvery: 깨어 있는 동안 하트 1칸이 줄어드는 간격
// poopEvery: 깨어 있는 동안 똥을 싸는 간격
// callTimeout: 배고픔/힘이 0인 상태로 이 시간이 지나면 케어 실수
export const STAGE_CONFIG = {
  egg: { duration: 1 },
  baby: { duration: 20, hungerEvery: 4, strengthEvery: 5, poopEvery: 8, callTimeout: 10, minWeight: 5 },
  child: { duration: 180, hungerEvery: 30, strengthEvery: 30, poopEvery: 40, callTimeout: 30, minWeight: 10 },
  rookie: { duration: 1440, hungerEvery: 60, strengthEvery: 60, poopEvery: 90, callTimeout: 60, minWeight: 15 },
  champion: { duration: 2880, hungerEvery: 75, strengthEvery: 75, poopEvery: 120, callTimeout: 60, minWeight: 20 },
  ultimate: { duration: Infinity, hungerEvery: 90, strengthEvery: 90, poopEvery: 150, callTimeout: 60, minWeight: 30 },
};

export const MAX_HEARTS = 4;
export const POOP_MAX = 4; // 똥이 이만큼 쌓이면 병에 걸린다

export const CALL_REPEAT_MIN = 240; // 계속 방치하면 이 간격마다 케어 실수가 추가된다
export const LIGHTS_GRACE_MIN = 60; // 잠든 뒤 이 시간 안에 불을 꺼야 한다
export const SICK_CALL_MIN = 120; // 아픈 채로 이 시간 방치하면 케어 실수
export const SICK_DEATH_MIN = 24 * 60; // 아픈 채로 이 시간 방치하면 사망
export const STARVE_DEATH_MIN = 18 * 60; // 깨어 있는 동안 배고픔 0이 이 시간 이어지면 사망

export const MAX_CATCHUP_MIN = 60 * 24 * 30; // 오프라인 시뮬레이션 상한 (30일)

export const BATTLE_MIN_STAGE = 'rookie';
export const BATTLE_INJURY_CHANCE = 0.2;
export const BATTLE_WEIGHT_COST = 2;
export const TRAIN_WEIGHT_COST = 1;

export const TRAIN_ROUNDS = 5;
export const TRAIN_PASS = 3; // 5번 중 이만큼 맞히면 훈련 성공

export const DEFAULT_SETTINGS = {
  sleepHour: 23, // 취침 시각 (0-23)
  wakeHour: 7, // 기상 시각 (0-23)
  sound: true,
  speed: 1, // 디버그용 시간 배속
};
