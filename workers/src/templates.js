// Templates - ESM version of lib/templates.js (same data)

const templates = {
  flowchart: {
    name: '流程图',
    type: 'flowchart',
    code: `flowchart TD
    A[开始] --> B{条件判断}
    B -->|是| C[执行操作A]
    B -->|否| D[执行操作B]
    C --> E[结束]
    D --> E`
  },
  swimlane: {
    name: '泳道图',
    type: 'swimlane',
    code: `flowchart TD
    subgraph 前端
        A[用户请求] --> B[页面渲染]
    end
    subgraph 后端
        C[API处理] --> D[业务逻辑]
    end
    subgraph 数据库
        E[(数据存储)]
    end
    B --> C
    D --> E
    E --> D
    D --> C
    C --> B`
  },
  stateDiagram: {
    name: '状态图',
    type: 'stateDiagram',
    code: `stateDiagram-v2
    [*] --> 待处理
    待处理 --> 进行中 : 开始处理
    进行中 --> 已完成 : 完成
    进行中 --> 已挂起 : 挂起
    已挂起 --> 进行中 : 恢复
    已完成 --> [*]`
  },
  sequence: {
    name: '时序图',
    type: 'sequence',
    code: `sequenceDiagram
    participant C as 客户端
    participant S as 服务器
    participant D as 数据库
    C->>S: HTTP请求
    S->>D: 查询数据
    D-->>S: 返回结果
    S-->>C: HTTP响应`
  },
  classDiagram: {
    name: '类图',
    type: 'classDiagram',
    code: `classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +String breed
        +fetch()
    }
    class Cat {
        +String color
        +purr()
    }
    Animal <|-- Dog
    Animal <|-- Cat`
  },
  gantt: {
    name: '甘特图',
    type: 'gantt',
    code: `gantt
    title 项目计划
    dateFormat YYYY-MM-DD
    section 设计阶段
        需求分析     :a1, 2024-01-01, 7d
        UI设计       :a2, after a1, 5d
    section 开发阶段
        前端开发     :b1, after a2, 10d
        后端开发     :b2, after a2, 12d
    section 测试阶段
        测试         :c1, after b2, 5d
        上线         :milestone, after c1, 0d`
  },
  erDiagram: {
    name: 'ER图',
    type: 'erDiagram',
    code: `erDiagram
    USER {
        int id PK
        string name
        string email
    }
    ORDER {
        int id PK
        int user_id FK
        date created_at
        float total
    }
    PRODUCT {
        int id PK
        string name
        float price
    }
    USER ||--o{ ORDER : places
    ORDER ||--|{ PRODUCT : contains`
  },
  pie: {
    name: '饼图',
    type: 'pie',
    code: `pie title 浏览器市场份额
    "Chrome" : 65
    "Safari" : 19
    "Firefox" : 4
    "Edge" : 4
    "其他" : 8`
  },
  mindmap: {
    name: '思维导图',
    type: 'mindmap',
    code: `mindmap
  root((项目管理))
    计划
      需求分析
      资源分配
      时间规划
    执行
      开发
      测试
      部署
    监控
      进度跟踪
      风险管理
      质量保证`
  }
};

export function getTemplates() {
  return templates;
}

export function getTemplate(type) {
  return templates[type] || null;
}
