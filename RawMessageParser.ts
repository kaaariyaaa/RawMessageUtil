import {
  world,
  Dimension,
  Entity,
  Block,
  Vector3,
  ScoreboardIdentity,
  ScoreboardObjective, // Objectiveの型として明示
  Player,
  ScoreboardScoreInfo, // getScores()の戻り値の型
} from "@minecraft/server";
import { EntitySelector } from "./EntitySelectorParser"; // EntitySelectorParser.ts が同じ階層にあると仮定

// RawMessageの型定義
interface RawMessage {
  text?: string;
  translate?: string;
  with?: string[] | RawMessage;
  score?: RawMessageScore;
  selector?: string;
  rawtext?: RawMessage[];
}

interface RawMessageScore {
  name: string; // スコアホルダー名 (プレイヤー名、セレクタ、"*"、またはフェイクプレイヤー名)
  objective: string; // 目的名
  // value?: string; // 通常、Script API側で設定するものではなく、ゲームが解釈するもの
}

interface RawText {
  rawtext?: RawMessage[];
}

// ExecutionContext interface to simplify parameter passing
interface ExecutionContext {
  dimension: Dimension;
  location?: Vector3;
  executor?: Entity;
}

export class RawTextParser {
  /**
   * RawMessage、RawMessage の配列、RawText オブジェクト、または rawText形式のJSON文字列をプレーンテキストに変換します。
   * @param rawInput 変換する RawMessage、RawMessage の配列、RawText オブジェクト、または rawText形式のJSON文字列。
   * @param executionSource オプション。セレクタの解決やスコア取得の基準となるエンティティ、ブロック、またはディメンション。
   * @returns 変換されたプレーンテキスト文字列。
   */
  public static parse(
    rawInput: RawMessage | RawMessage[] | RawText | string | undefined,
    executionSource?: Entity | Block | Dimension | Vector3
  ): string {
    if (!rawInput) {
      return "";
    }

    // Parse string input to object if needed
    const parsedObject = this.parseInputToObject(rawInput);
    if (!parsedObject) {
      return "";
    }

    // Create execution context from source
    const context = this.createExecutionContext(executionSource);

    // Process different input types
    if (Array.isArray(parsedObject)) {
      return parsedObject.map((msg) => this.parseSingleMessage(msg, context)).join("");
    } else if (this.isRawText(parsedObject)) {
      return (parsedObject.rawtext || []).map((msg) => this.parseSingleMessage(msg, context)).join("");
    } else if (this.isRawMessage(parsedObject)) {
      return this.parseSingleMessage(parsedObject, context);
    } else {
      return String(parsedObject).replace(/§[0-9a-fk-or]/g, "");
    }
  }

  /**
   * Parses string input to object if needed
   */
  private static parseInputToObject(
    rawInput: RawMessage | RawMessage[] | RawText | string | undefined
  ): RawMessage | RawMessage[] | RawText | string | undefined {
    if (typeof rawInput === "string") {
      try {
        return JSON.parse(rawInput) as RawMessage | RawMessage[] | RawText;
      } catch (error) {
        return rawInput.replace(/§[0-9a-fk-or]/g, "");
      }
    }
    return rawInput;
  }

  /**
   * Type guard for RawText objects
   */
  private static isRawText(obj: any): obj is RawText {
    return typeof obj === "object" && !Array.isArray(obj) && "rawtext" in obj;
  }

  /**
   * Type guard for RawMessage objects
   */
  private static isRawMessage(obj: any): obj is RawMessage {
    return typeof obj === "object" && !Array.isArray(obj);
  }

  /**
   * Creates execution context from source
   */
  private static createExecutionContext(executionSource?: Entity | Block | Dimension | Vector3): ExecutionContext {
    const context: ExecutionContext = {
      dimension: world.getDimension("overworld"),
    };

    if (executionSource) {
      if (executionSource instanceof Dimension) {
        context.dimension = executionSource;
      } else if (executionSource instanceof Block) {
        context.dimension = executionSource.dimension;
        context.location = executionSource.location;
      } else if (executionSource instanceof Entity) {
        context.dimension = executionSource.dimension;
        context.location = executionSource.location;
        context.executor = executionSource;
      } else if (
        typeof executionSource === "object" &&
        "x" in executionSource &&
        "y" in executionSource &&
        "z" in executionSource
      ) {
        context.location = executionSource;
      }
    }

    return context;
  }

  /**
   * Parses a single RawMessage object to plain text
   */
  private static parseSingleMessage(message: RawMessage, context: ExecutionContext): string {
    let result = "";

    if (message.text) {
      result += message.text.replace(/§[0-9a-fk-or]/g, "");
    } else if (message.translate) {
      result += this.handleTranslate(message, context);
    } else if (message.score && message.score.name && message.score.objective && context.dimension) {
      result += this.handleScore(message.score, context);
    } else if (message.selector && context.dimension) {
      result += this.handleSelector(message.selector, context);
    }

    if (message.rawtext && Array.isArray(message.rawtext)) {
      result += message.rawtext.map((nestedMsg) => this.parseSingleMessage(nestedMsg, context)).join("");
    }

    return result;
  }

  /**
   * Handles translate component
   */
  private static handleTranslate(message: RawMessage, context: ExecutionContext): string {
    let translatedText = `[${message.translate}]`;

    if (message.with) {
      const withValues = Array.isArray(message.with)
        ? message.with.map((val) => (typeof val === "string" ? val : this.parseSingleMessage(val, context))).join(", ")
        : this.parseSingleMessage(message.with, context);

      translatedText = `[${message.translate} with (${withValues})]`;
    }

    return translatedText;
  }

  /**
   * Handles score component
   */
  private static handleScore(scoreInfo: RawMessageScore, context: ExecutionContext): string {
    const scoreHolderName = scoreInfo.name;
    let scoreValueText = "0"; // Default if score not found

    try {
      const objective = world.scoreboard.getObjective(scoreInfo.objective);
      if (!objective) {
        console.warn(`Objective "${scoreInfo.objective}" not found.`);
        return scoreValueText;
      }

      // Handle different score holder types
      if (scoreHolderName === "*") {
        // Wildcard refers to executor itself
        scoreValueText = this.getScoreForExecutor(objective, context);
      } else if (scoreHolderName.startsWith("@")) {
        // Selector case
        scoreValueText = this.getScoreForSelector(scoreHolderName, objective, context);
      } else {
        // Player name or fake player name
        scoreValueText = this.getScoreForName(scoreHolderName, objective);
      }
    } catch (e) {
      console.warn(`Error retrieving score for "${scoreInfo.name}" on "${scoreInfo.objective}": ${e}`);
    }

    return scoreValueText;
  }

  /**
   * Gets score for the executor entity
   */
  private static getScoreForExecutor(objective: ScoreboardObjective, context: ExecutionContext): string {
    if (!context.executor || !context.executor.scoreboardIdentity) {
      return "0";
    }

    try {
      const score = objective.getScore(context.executor.scoreboardIdentity);
      return score !== undefined ? String(score) : "0";
    } catch (e) {
      console.warn(`Error getting score for executor: ${e}`);
      return "0";
    }
  }

  /**
   * Gets score for an entity selector
   */
  private static getScoreForSelector(
    selectorString: string,
    objective: ScoreboardObjective,
    context: ExecutionContext
  ): string {
    try {
      const selector = new EntitySelector(selectorString, context.dimension, context.location, context.executor);

      const selectedEntities = selector.getEntities();
      if (selectedEntities.length > 0 && selectedEntities[0].scoreboardIdentity) {
        const score = objective.getScore(selectedEntities[0].scoreboardIdentity);
        return score !== undefined ? String(score) : "0";
      }
    } catch (e) {
      console.warn(`Error resolving selector for score: ${selectorString} - ${e}`);
    }

    return "0";
  }

  /**
   * Gets score for a specific name (player or fake player)
   */
  private static getScoreForName(name: string, objective: ScoreboardObjective): string {
    // Try to find the score by name in the objective's scores
    const allScoresOnObjective: ScoreboardScoreInfo[] = objective.getScores();
    const foundScoreInfo = allScoresOnObjective.find((s) => s.participant.displayName === name);

    if (foundScoreInfo) {
      return String(foundScoreInfo.score);
    }

    // Check if the participant exists but doesn't have a score yet
    const participants = world.scoreboard.getParticipants();
    const foundParticipant = participants.find((p) => p.displayName === name);

    if (foundParticipant) {
      try {
        const score = objective.getScore(foundParticipant);
        return score !== undefined ? String(score) : "0";
      } catch (e) {
        console.warn(`Error in objective.getScore for ${name}: ${e}`);
      }
    }

    return "0";
  }

  /**
   * Handles selector component
   */
  private static handleSelector(selectorStr: string, context: ExecutionContext): string {
    try {
      const selector = new EntitySelector(selectorStr, context.dimension, context.location, context.executor);

      const selectedEntities = selector.getEntities();
      if (selectedEntities.length > 0) {
        return selectedEntities
          .map((e) => {
            if (e instanceof Player) {
              return e.name;
            } else {
              return e.nameTag || e.typeId;
            }
          })
          .join(", ");
      }
    } catch (e) {
      console.warn(`Error resolving selector ${selectorStr}: ${e}`);
    }

    return "";
  }
}
