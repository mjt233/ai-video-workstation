<template>
  <div
    v-if="data"
    style="flex: 1; min-height: 0; overflow-y: auto;"
  >
    <v-tabs v-model="tab">
      <v-tab value="overview">
        总览
      </v-tab>
      <v-tab value="script">
        台词
      </v-tab>
      <v-tab value="images">
        场景图片
      </v-tab>
      <v-tab value="video">
        视频生成
      </v-tab>
      <v-tab value="custom">
        自定义资产
      </v-tab>
      <v-tab value="canvas">
        资产画布
      </v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="overview">
        <div class="d-flex mt-2 mb-2 ml-2">
          <v-btn @click="editOverview">
            编辑
          </v-btn>
        </div>
        <v-card
          v-if="data.overview"
          class="ma-2"
        >
          <v-card-title class="text-h6">
            {{ data.overview.title || '（无标题）' }}
            <v-chip
              class="ml-2"
              size="small"
              color="primary"
              variant="tonal"
            >
              {{ data.overview.duration }} 秒
            </v-chip>
          </v-card-title>
          <v-card-text>
            <div class="mb-3">
              <div class="text-caption text-medium-emphasis mb-1">
                叙事节拍
              </div>
              <div class="text-body-2 overview-text">
                {{ data.overview.beat || '（空）' }}
              </div>
            </div>
            <div class="mb-3">
              <div class="text-caption text-medium-emphasis mb-1">
                画面描述
              </div>
              <div class="text-body-2 overview-text">
                {{ data.overview.visual || '（空）' }}
              </div>
            </div>
            <div class="mb-3">
              <div class="text-caption text-medium-emphasis mb-1">
                镜头运动
              </div>
              <div class="text-body-2 overview-text">
                {{ data.overview.camera || '（空）' }}
              </div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis mb-1">
                情绪基调
              </div>
              <div class="text-body-2 overview-text">
                {{ data.overview.mood || '（空）' }}
              </div>
            </div>
          </v-card-text>
        </v-card>
        <div
          v-else
          class="text-grey ml-2"
        >
          暂无 overview.json
        </div>
      </v-tabs-window-item>

      <v-tabs-window-item value="script">
        <div class="d-flex mt-2 mb-2 ml-2 ga-2">
          <v-btn
            color="primary"
            prepend-icon="mdi-plus"
            @click="openScriptDialog('add')"
          >
            新增台词
          </v-btn>
          <v-btn
            variant="text"
            @click="editJson('script')"
          >
            编辑 JSON
          </v-btn>
          <v-btn
            variant="tonal"
            color="secondary"
            prepend-icon="mdi-waveform"
            :disabled="!hasFullVoice"
            @click="showAudioEditor = true"
          >
            分镜音频编辑
          </v-btn>
        </div>
        <!-- 已编辑保存的分镜合并音频预览 -->
        <v-card
          v-if="hasMergedAudio"
          class="mx-2 mb-2"
          variant="tonal"
          color="secondary"
        >
          <v-card-text class="d-flex align-center ga-3 py-2 flex-wrap">
            <v-icon color="secondary">
              mdi-waveform
            </v-icon>
            <span class="text-body-2">已保存的分镜合并音频：</span>
            <audio
              :src="mergedAudioUrl"
              controls
              preload="metadata"
              style="max-width: 460px;"
            >
              您的浏览器不支持音频预览
            </audio>
          </v-card-text>
        </v-card>
        <v-list
          v-if="data.script.length"
          lines="two"
        >
          <v-list-item
            v-for="(entry, i) in data.script"
            :key="i"
          >
            <template #prepend>
              <v-avatar
                color="primary"
                size="32"
              >
                <span class="text-caption">{{ i + 1 }}</span>
              </v-avatar>
            </template>
            <v-list-item-title>
              <strong>{{ entry.角色名 }}</strong>
              <v-chip
                class="ml-2 mb-1"
                size="x-small"
                color="grey"
                variant="outlined"
              >
                {{ entry.情绪 }}
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle>
              <div class="d-flex flex-column">
                <p>{{ entry.台词 }}</p>
                <audio
                  v-if="voiceAssets[i]"
                  class="mt-2"
                  style="height: 32px;"
                  :src="voiceAssets[i]"
                  controls
                  preload="metadata"
                />
              </div>
            </v-list-item-subtitle>
            <template #append>
              <div class="d-flex align-center ga-1">
                <v-btn
                  size="x-small"
                  icon="mdi-pencil"
                  variant="text"
                  title="编辑"
                  @click="openScriptDialog('edit', i)"
                />
                <v-btn
                  size="x-small"
                  icon="mdi-delete"
                  variant="text"
                  color="error"
                  title="删除"
                  @click="deleteScriptEntry(i)"
                />
                <v-btn
                  size="x-small"
                  icon="mdi-arrow-up"
                  variant="text"
                  :disabled="i === 0"
                  @click="moveScriptEntry(i, i - 1)"
                />
                <v-btn
                  size="x-small"
                  icon="mdi-arrow-down"
                  variant="text"
                  :disabled="i === data.script.length - 1"
                  @click="moveScriptEntry(i, i + 1)"
                />
                <v-divider
                  vertical
                  class="mx-1"
                />
                <v-btn
                  size="x-small"
                  variant="tonal"
                  prepend-icon="mdi-account-voice"
                  @click="genDialog = { show: true, type: 'voice', index: i }"
                >
                  {{ voiceAssets[i] ? '重新生成' : '生成语音' }}
                </v-btn>
                <v-btn
                  size="x-small"
                  variant="text"
                  prepend-icon="mdi-history"
                  :disabled="!voiceAssets[i]"
                  @click="openVoiceHistory(i)"
                >
                  历史
                </v-btn>
              </div>
            </template>
          </v-list-item>
        </v-list>
        <div v-else>
          <p class="ml-2">
            该分镜没有台词
          </p>
        </div>
      </v-tabs-window-item>

      <v-tabs-window-item value="images">
        <div class="d-flex mt-2 mb-2 ml-2 ga-2 flex-wrap">
          <v-btn
            color="primary"
            prepend-icon="mdi-plus"
            @click="openCreateStageFrame"
          >
            新增场景
          </v-btn>
          <v-btn
            variant="text"
            @click="editStageJson"
          >
            编辑 stage.json
          </v-btn>
        </div>

        <div
          v-for="(stage, i) in stageDefs"
          :key="i"
          class="mb-4"
        >
          <v-card
            variant="outlined"
            :class="{ 'stage-disabled-card': stage.disabled }"
          >
            <v-card-title class="text-subtitle-1 d-flex align-center">
              <span>场景{{ i }}</span>
              <v-chip
                v-if="stage.disabled"
                class="ml-2"
                size="x-small"
                color="warning"
                variant="tonal"
              >
                已禁用
              </v-chip>
              <v-spacer />
              <v-btn
                icon="mdi-pencil"
                size="x-small"
                variant="text"
                title="编辑"
                @click="openEditStageFrame(i)"
              />
              <v-btn
                icon="mdi-delete"
                size="x-small"
                variant="text"
                color="error"
                title="删除"
                :disabled="stageDefs.length <= 1 || deletingStageIndex === i"
                @click="removeStageFrame(i)"
              />
              <v-btn
                :icon="stage.disabled ? 'mdi-eye-off' : 'mdi-eye'"
                size="x-small"
                variant="text"
                :color="stage.disabled ? 'warning' : ''"
                :title="stage.disabled ? '已禁用（视频生成跳过），点击启用' : '禁用（视频生成跳过）'"
                @click="toggleStageDisabled(i)"
              />
              <v-btn
                icon="mdi-arrow-up"
                size="x-small"
                variant="text"
                :disabled="i === 0 || reordering"
                @click="moveStage(i, i - 1)"
              />
              <v-btn
                icon="mdi-arrow-down"
                size="x-small"
                variant="text"
                :disabled="i === stageDefs.length - 1 || reordering"
                @click="moveStage(i, i + 1)"
              />
            </v-card-title>
            <v-card-text>
              <v-row>
                <v-col cols="6">
                  <div class="mb-2">
                    <div class="text-caption text-medium-emphasis mb-1">
                      基础场景
                    </div>
                    <v-menu
                      v-if="stage.基础场景"
                      open-on-hover
                      :close-on-content-click="false"
                      location="top"
                      offset="8"
                    >
                      <template #activator="{ props: menuProps }">
                        <v-chip
                          v-bind="menuProps"
                          size="small"
                          color="primary"
                          variant="tonal"
                        >
                          {{ isPrevStageRef(stage.基础场景) ? 'prev（上一分镜最后场景）' : stage.基础场景 }}
                        </v-chip>
                      </template>
                      <v-card
                        max-width="280"
                        class="pa-2"
                      >
                        <v-img
                          v-if="stageAssetUrls[stage.基础场景]"
                          :src="stageAssetUrls[stage.基础场景]"
                          width="260"
                          max-height="260"
                          contain
                        />
                        <div
                          v-else
                          class="d-flex flex-column align-center ga-2 pa-2"
                        >
                          <div class="text-caption text-medium-emphasis">
                            {{ isPrevStageRef(stage.基础场景) ? '上一分镜最后场景图尚未生成' : '暂无设定图' }}
                          </div>
                          <v-btn
                            v-if="!isPrevStageRef(stage.基础场景)"
                            size="small"
                            color="primary"
                            variant="tonal"
                            prepend-icon="mdi-auto-fix"
                            :disabled="!parseStageRef(stage.基础场景)?.name"
                            @click="openStageAssetGen(stage.基础场景)"
                          >
                            生成场景设定图
                          </v-btn>
                        </div>
                      </v-card>
                    </v-menu>
                    <v-chip
                      v-else
                      size="small"
                      color="primary"
                      variant="tonal"
                    >
                      未指定
                    </v-chip>
                  </div>
                  <div class="mb-2">
                    <div class="text-caption text-medium-emphasis mb-1">
                      登场角色
                    </div>
                    <div
                      v-if="stage.登场角色?.length"
                      class="d-flex flex-wrap ga-1"
                    >
                      <v-menu
                        v-for="charName in stage.登场角色"
                        :key="charName"
                        open-on-hover
                        :close-on-content-click="false"
                        location="top"
                        offset="8"
                      >
                        <template #activator="{ props: menuProps }">
                          <v-chip
                            v-bind="menuProps"
                            size="small"
                            variant="outlined"
                          >
                            {{ charName }}
                          </v-chip>
                        </template>
                        <v-card
                          max-width="280"
                          class="pa-2"
                        >
                          <v-img
                            v-if="characterAssetUrls[charName]"
                            :src="characterAssetUrls[charName]"
                            width="260"
                            max-height="260"
                            contain
                          />
                          <div
                            v-else
                            class="d-flex flex-column align-center ga-2 pa-2"
                          >
                            <div class="text-caption text-medium-emphasis">
                              暂无设定图
                            </div>
                            <v-btn
                              size="small"
                              color="primary"
                              variant="tonal"
                              prepend-icon="mdi-auto-fix"
                              @click="openCharacterAssetGen(charName)"
                            >
                              生成角色设定图
                            </v-btn>
                          </div>
                        </v-card>
                      </v-menu>
                    </div>
                    <div
                      v-else
                      class="text-grey text-body-2"
                    >
                      {{
                        isDirectStageRef(stage)
                          ? (isPrevStageRef(stage.基础场景) ? '直接引用上一分镜最后场景' : '直接引用基础场景')
                          : '无'
                      }}
                    </div>
                  </div>
                  <div>
                    <div class="text-caption text-medium-emphasis mb-1">
                      合成 Prompt
                    </div>
                    <div class="text-body-2 stage-prompt">
                      {{
                        stage.prompt
                          || (isDirectStageRef(stage)
                            ? (isPrevStageRef(stage.基础场景) ? '（直接引用上一分镜最后场景，不做修改）' : '（直接引用，不做修改）')
                            : '（空）')
                      }}
                    </div>
                  </div>
                </v-col>
                <v-col
                  cols="6"
                  class="d-flex flex-column align-center"
                >
                  <div class="d-flex justify-center mb-3 ga-2 flex-wrap">
                    <v-btn
                      size="small"
                      color="primary"
                      variant="tonal"
                      prepend-icon="mdi-auto-fix"
                      @click="genDialog = { show: true, type: 'image', index: i }"
                    >
                      生成图片
                    </v-btn>
                    <AssetImageUploadButton
                      :project="props.project"
                      :asset-path="`assert/scene/${props.episode}/${props.shot}/stage/${i}.jpg`"
                      @uploaded="load"
                    />
                    <v-btn
                      size="small"
                      variant="text"
                      prepend-icon="mdi-history"
                      :disabled="!stage.imageUrl"
                      @click="openStageImageHistory(i)"
                    >
                      历史版本
                    </v-btn>
                  </div>
                  <v-img
                    v-if="stage.imageUrl"
                    :src="stage.imageUrl"
                    max-height="65vh"
                    contain
                    width="100%"
                  />
                  <div
                    v-else
                    class="text-grey d-flex align-center justify-center"
                    style="height: 200px; width: 100%;"
                  >
                    暂无图片
                  </div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </div>

        <div
          v-if="!stageDefs.length"
          class="text-grey ml-2"
        >
          暂无场景图片定义（stage.json）
        </div>
      </v-tabs-window-item>
      <v-tabs-window-item value="video">
        <div class="d-flex mt-2 mb-2 ml-2">
          <v-btn
            @click="edit('prompt')"
          >
            编辑
          </v-btn>
        </div>
        <v-alert
          v-if="disabledStageCount > 0"
          type="warning"
          density="compact"
          variant="tonal"
          class="mx-2 mb-2"
        >
          有 {{ disabledStageCount }} 个场景帧已禁用，视频生成将跳过它们，仅使用 {{ stageDefs.length - disabledStageCount }} 个场景帧。
        </v-alert>

        <!-- 视频导演台：双轨编排关键帧与音频 -->
        <v-card class="mx-2 mb-2">
          <v-card-title class="text-subtitle-1 py-2">
            视频导演台
          </v-card-title>
          <v-card-text
            class="pa-2"
            style="height: 480px;"
          >
            <div
              v-if="directorLoading"
              class="d-flex align-center justify-center"
              style="height: 100%;"
            >
              <v-progress-circular indeterminate />
            </div>
            <VideoDirector
              v-else
              :project="props.project"
              :director="director"
              :allow-add-asset="true"
              @update:director="(p) => { director = p }"
              @save="saveDirector"
              @generate="generateVideo"
            />
          </v-card-text>
        </v-card>

        <MarkdownView :content="data.prompt" />
        <div
          v-if="hasVideo"
          class="d-flex justify-center ma-4"
        >
          <video
            :src="`/api/fs/${props.project}/assert/scene/${props.episode}/${props.shot}/video/0.mp4?t=${Date.now()}`"
            controls
            style="max-width: 100%; max-height: 50vh;"
          >
            您的浏览器不支持视频预览
          </video>
        </div>
        <div class="d-flex justify-center mt-2 ga-2 flex-wrap">
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-video"
            @click="openVideoGen"
          >
            生成视频
          </v-btn>
          <v-btn
            variant="text"
            prepend-icon="mdi-history"
            :disabled="!hasVideo"
            @click="openVideoHistory"
          >
            历史版本
          </v-btn>
        </div>
      </v-tabs-window-item>

      <v-tabs-window-item value="custom">
        <div class="pa-2">
          <div class="text-body-2 text-medium-emphasis mb-2">
            该分镜的自定义资产存储在 <code>assert/custom/scene/{{ props.episode }}/{{ props.shot }}/</code> 下，支持上传、预览与删除。
          </div>
          <CustomAssetSection
            :project="props.project"
            :dir-rel-path="`scene/${props.episode}/${props.shot}`"
          />
        </div>
      </v-tabs-window-item>

      <v-tabs-window-item value="canvas">
        <AssetCanvas
          :project="props.project"
          kind="scene"
          :episode="props.episode"
          :shot="props.shot"
        />
      </v-tabs-window-item>
    </v-tabs-window>

    <v-dialog
      v-model="dialog.show"
      max-width="800"
    >
      <v-card>
        <v-card-title>编辑 {{ dialog.field }}</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="dialog.content"
            rows="15"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="dialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            @click="save"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="overviewDialog.show"
      max-width="720"
    >
      <v-card>
        <v-card-title>编辑分镜总览</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="overviewDialog.form.title"
            label="标题"
            variant="outlined"
            density="comfortable"
            class="mb-2"
          />
          <v-text-field
            v-model.number="overviewDialog.form.duration"
            label="时长（秒）"
            type="number"
            min="1"
            step="1"
            variant="outlined"
            density="comfortable"
            class="mb-2"
            :error-messages="overviewDurationError"
          />
          <v-textarea
            v-model="overviewDialog.form.beat"
            label="叙事节拍"
            rows="3"
            auto-grow
            variant="outlined"
            class="mb-2"
          />
          <v-textarea
            v-model="overviewDialog.form.visual"
            label="画面描述"
            rows="4"
            auto-grow
            variant="outlined"
            class="mb-2"
          />
          <v-textarea
            v-model="overviewDialog.form.camera"
            label="镜头运动"
            rows="3"
            auto-grow
            variant="outlined"
            class="mb-2"
          />
          <v-textarea
            v-model="overviewDialog.form.mood"
            label="情绪基调"
            rows="2"
            auto-grow
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="overviewDialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :loading="overviewDialog.saving"
            @click="saveOverview"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <GenerateDialog
      v-model="genImageDialog"
      :project="props.project"
      workflow-id="image-edit"
      workflow-name="分镜场景图生成（图片编辑）"
      :vars="{
        desc: '',
        imagePaths: '[]',
        purpose: 'scene-stage-image',
        episode: props.episode,
        shot: props.shot,
        index: String(genDialog.index),
      }"
      :output-path="`assert/scene/${props.episode}/${props.shot}/stage/${genDialog.index}.jpg`"
      :prompt-paths="[`${basePath}/stage.json`]"
      :existing-asset="stageDefs[genDialog.index]?.imageUrl ? '已有图片' : undefined"
      @refresh="load"
    />
    <GenerateDialog
      v-model="genVoiceDialog"
      :project="props.project"
      workflow-id="tts-voice-design"
      workflow-name="分镜台词语音生成（音色设计）"
      :vars="{
        desc: '',
        text: '',
        purpose: 'scene-tts',
        episode: props.episode,
        shot: props.shot,
        index: String(genDialog.index),
        character: data?.script[genDialog.index]?.角色名 ?? '',
      }"
      :output-path="`assert/scene/${props.episode}/${props.shot}/voice/${genDialog.index}-${data?.script[genDialog.index]?.角色名 ?? ''}.flac`"
      :prompt-paths="[`${basePath}/script.json`]"
      :existing-asset="voiceAssets[genDialog.index] ? '已有音频' : undefined"
      @refresh="load"
    />
    <GenerateDialog
      v-model="genVideoDialog"
      :project="props.project"
      workflow-id="image-to-video"
      workflow-name="视频生成（图生视频）"
      :vars="{ episode: props.episode, shot: props.shot }"
      :output-path="`assert/scene/${props.episode}/${props.shot}/video/0.mp4`"
      :prompt-paths="[`${basePath}/prompt.md`]"
      :existing-asset="hasVideo ? '已有视频' : undefined"
      :hint="directorHint"
      @refresh="load"
    />
    <GenerateDialog
      v-model="genStageAssetDialog"
      :project="props.project"
      :workflow-id="stageAssetWorkflowId"
      :workflow-name="stageAssetWorkflowName"
      :vars="stageAssetVars"
      :output-path="stageAssetOutputPath"
      :prompt-paths="[`prompt/stage/${refGenDialog.name}/${refGenDialog.label}.md`]"
      :existing-asset="stageAssetExisting"
      @refresh="load"
    />
    <GenerateDialog
      v-model="genCharacterAssetDialog"
      :project="props.project"
      workflow-id="text-to-image"
      workflow-name="角色设定图生成（文生图）"
      :vars="{
        promptPath: `prompt/character/${refGenDialog.name}/appearance.md`,
        width: '1280',
        height: '720',
        purpose: 'character-appearance',
        name: refGenDialog.name,
      }"
      :output-path="`assert/character/${refGenDialog.name}/appearance.jpg`"
      :prompt-paths="[`prompt/character/${refGenDialog.name}/appearance.md`]"
      :existing-asset="characterAssetUrls[refGenDialog.name] ? '已有图片' : undefined"
      @refresh="load"
    />

    <StageFrameDialog
      v-model="stageFrameDialog.show"
      :project="props.project"
      :episode="props.episode"
      :shot="props.shot"
      :mode="stageFrameDialog.mode"
      :index="stageFrameDialog.index"
      :initial="stageFrameDialog.initial"
      @saved="load"
    />

    <AssetHistoryDialog
      v-model="historyDialog.show"
      :project="props.project"
      :asset-path="historyDialog.path"
      @activated="load"
    />

    <ScriptEditDialog
      v-model="scriptDialog.show"
      :mode="scriptDialog.mode"
      :entry="scriptDialog.entry"
      :character-names="characterNames"
      @save="onScriptSave"
    />

    <AudioEditor
      v-model="showAudioEditor"
      :project="props.project"
      :episode="props.episode"
      :shot="props.shot"
      @refresh="load"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { readFs, writeFs, existsFs, type DirResponse } from '../api/client'
import {
  reorderSceneStage,
  reorderSceneScript,
  deleteSceneStageFrame,
  deleteSceneScriptEntry,
  updateSceneScriptEntry,
  updateSceneStageFrame,
  deleteSceneMergedAudio,
  AssetApiError,
} from '../api/assets'
import { confirm } from '../utils/confirm'
import MarkdownView from './MarkdownView.vue'
import GenerateDialog from './GenerateDialog.vue'
import StageFrameDialog from './StageFrameDialog.vue'
import AssetHistoryDialog from './AssetHistoryDialog.vue'
import AssetImageUploadButton from './AssetImageUploadButton.vue'
import ScriptEditDialog from './ScriptEditDialog.vue'
import AudioEditor from './audio-editor/AudioEditor.vue'
import CustomAssetSection from './CustomAssetSection.vue'
import AssetCanvas from './canvas/AssetCanvas.vue'
import VideoDirector from './video-director/VideoDirector.vue'
import {
  readDirectorConfig,
  writeDirectorConfig,
  emptyDirectorProject,
} from '../api/director'
import type { DirectorProject } from './video-director/types'

interface ScriptEntry {
  角色名: string
  台词: string
  情绪: string
}

interface ShotOverview {
  title: string
  beat: string
  visual: string
  camera: string
  duration: number
  mood: string
}

interface StageDefinition {
  基础场景: string
  登场角色?: string[]
  prompt: string
  /** 该场景帧是否被禁用（视频生成时跳过） */
  disabled: boolean
  imageUrl: string
}

interface DialogState {
  show: boolean
  field: string
  content: string
}

interface OverviewDialogState {
  show: boolean
  saving: boolean
  form: ShotOverview
}

interface SceneData {
  overview: ShotOverview | null
  script: ScriptEntry[]
  prompt: string
  stage: StageDefinition[]
}

function emptyOverview(): ShotOverview {
  return {
    title: '',
    beat: '',
    visual: '',
    camera: '',
    duration: 5,
    mood: '',
  }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function cloneOverview(source?: ShotOverview | null): ShotOverview {
  if (!source) return emptyOverview()
  return {
    title: source.title ?? '',
    beat: source.beat ?? '',
    visual: source.visual ?? '',
    camera: source.camera ?? '',
    duration: isPositiveInt(source.duration) ? source.duration : 5,
    mood: source.mood ?? '',
  }
}

function parseOverview(raw: unknown): ShotOverview | null {
  if (!raw) return null
  let obj: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return null
    try {
      obj = JSON.parse(text)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const data = obj as Record<string, unknown>
  const durationRaw = data.duration
  let duration = 5
  if (isPositiveInt(durationRaw)) {
    duration = durationRaw
  } else if (typeof durationRaw === 'string' && durationRaw.trim()) {
    const n = Number(durationRaw)
    if (isPositiveInt(n)) duration = n
  }
  return {
    title: typeof data.title === 'string' ? data.title : '',
    beat: typeof data.beat === 'string' ? data.beat : '',
    visual: typeof data.visual === 'string' ? data.visual : '',
    camera: typeof data.camera === 'string' ? data.camera : '',
    duration,
    mood: typeof data.mood === 'string' ? data.mood : '',
  }
}

const props = defineProps<{ project: string; episode: string; shot: string }>()
const tab = ref<string | null>(null)
const data = ref<SceneData | null>(null)
const stageDefs = ref<StageDefinition[]>([])
/** 每条台词对应的语音 URL；无资产时为空字符串 */
const voiceAssets = ref<string[]>([])
/** 是否存在用户编辑保存的分镜合并音频（merged.flac） */
const hasMergedAudio = ref(false)
/** 分镜合并音频的预览 URL */
const mergedAudioUrl = ref('')
const hasVideo = ref(false)
const stageAssetUrls = ref<Record<string, string>>({})
const characterAssetUrls = ref<Record<string, string>>({})
const dialog = ref<DialogState>({ show: false, field: '', content: '' })
const overviewDialog = ref<OverviewDialogState>({
  show: false,
  saving: false,
  form: emptyOverview(),
})
const reordering = ref(false)
const deletingStageIndex = ref<number | null>(null)

interface ScriptForm {
  角色名: string
  台词: string
  情绪: string
}

const scriptDialog = ref<{
  show: boolean
  mode: 'add' | 'edit'
  index: number
  entry: ScriptForm | null
}>({
  show: false,
  mode: 'add',
  index: -1,
  entry: null,
})
const characterNames = ref<string[]>([])
const genDialog = ref<{ show: boolean; type: 'image' | 'voice' | 'video'; index: number }>({ show: false, type: 'image', index: 0 })
const refGenDialog = ref<{ show: boolean; type: 'character' | 'stage'; name: string; label: string; variantId?: string }>({
  show: false,
  type: 'character',
  name: '',
  label: '',
})
const stageFrameDialog = ref<{
  show: boolean
  mode: 'create' | 'edit'
  index?: number
  initial?: { 基础场景: string; 登场角色?: string[]; prompt?: string }
}>({ show: false, mode: 'create' })
const historyDialog = ref<{ show: boolean; path: string }>({ show: false, path: '' })
const showAudioEditor = ref(false)

/** 导演台项目（从 director.json 加载；无配置时为空白项目） */
const director = ref<DirectorProject>(emptyDirectorProject(5, 0, 0, 0))
/** 导演台配置是否加载中 */
const directorLoading = ref(false)

/** 视频生成对话框提示：存在导演台图片块时提示将使用导演台参数 */
const directorHint = computed(() => {
  const d = director.value
  return d && d.imageClips.length >= 1 ? '检测到导演台配置，将使用导演台参数生成' : ''
})

const hasFullVoice = computed(() => {
  const script = data.value?.script
  if (!script || !script.length) return false
  return voiceAssets.value.length > 0 && voiceAssets.value.every(v => v !== '')
})

/** 被禁用的场景帧数量（视频生成时跳过） */
const disabledStageCount = computed(() => stageDefs.value.filter((s) => s.disabled).length)

const overviewDurationError = computed(() => {
  const duration = overviewDialog.value.form.duration
  if (!isPositiveInt(duration)) {
    return '时长必须是大于 0 的整数秒'
  }
  return ''
})

/** 场景设定图输出路径，支持变体 */
const stageAssetOutputPath = computed(() => {
  const { name, label, variantId } = refGenDialog.value
  if (variantId) {
    return `assert/stage/${name}/variants/${label}/${variantId}.jpg`
  }
  return `assert/stage/${name}/${label}.jpg`
})

/** 场景设定图 workflow id，变体使用图片编辑工作流 */
const stageAssetWorkflowId = computed(() => {
  return refGenDialog.value.variantId ? 'image-edit' : 'text-to-image'
})

/** 场景设定图 workflow 名称 */
const stageAssetWorkflowName = computed(() => {
  return refGenDialog.value.variantId ? '场景变体图生成（图片编辑）' : '场景设定图生成（文生图）'
})

/** 场景设定图 workflow vars，变体时使用图片编辑参数 */
const stageAssetVars = computed((): Record<string, string> => {
  const { name, label, variantId } = refGenDialog.value
  if (variantId) {
    return {
      promptPath: `prompt/stage/${name}/${label}.md`,
      desc: '',
      imagePaths: JSON.stringify([`assert/stage/${name}/${label}.jpg`]),
      purpose: 'stage-variant',
      stageName: name,
      label,
      name,
      variantId,
    }
  }
  return {
    promptPath: `prompt/stage/${name}/${label}.md`,
    purpose: 'stage-image',
    stageName: name,
    label,
    name,
  }
})

/** 场景设定图在 stageAssetUrls 中的查询 key */
const stageAssetUrlKey = computed(() => {
  const { name, label, variantId } = refGenDialog.value
  if (variantId) {
    return `${name}/${label}@${variantId}`
  }
  return `${name}/${label}`
})

/** 场景设定图是否已有图片 */
const stageAssetExisting = computed(() => {
  return stageAssetUrls.value[stageAssetUrlKey.value] ? '已有图片' : undefined
})

async function moveStage(from: number, to: number) {
  if (reordering.value) return
  reordering.value = true
  try {
    await reorderSceneStage(props.project, props.episode, props.shot, from, to)
    await load()
  } catch (e) {
    alert(e instanceof AssetApiError ? e.message : '调整顺序失败')
  } finally {
    reordering.value = false
  }
}

function openCreateStageFrame() {
  stageFrameDialog.value = {
    show: true,
    mode: 'create',
    initial: { 基础场景: '', 登场角色: [], prompt: '' },
  }
}

function openEditStageFrame(index: number) {
  const stage = stageDefs.value[index]
  if (!stage) return
  stageFrameDialog.value = {
    show: true,
    mode: 'edit',
    index,
    initial: {
      基础场景: stage.基础场景 ?? '',
      登场角色: [...(stage.登场角色 ?? [])],
      prompt: stage.prompt ?? '',
    },
  }
}

async function removeStageFrame(index: number) {
  if (stageDefs.value.length <= 1) {
    alert('至少保留一个场景，无法删除')
    return
  }
  const ok = await confirm({
    title: '确认删除',
    content: `确定删除场景${index}？对应图片资产也会删除。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  deletingStageIndex.value = index
  try {
    await deleteSceneStageFrame(props.project, props.episode, props.shot, index)
    await load()
  } catch (e) {
    alert(e instanceof AssetApiError ? e.message : '删除失败')
  } finally {
    deletingStageIndex.value = null
  }
}

/**
 * 切换指定场景帧的禁用状态。
 * 禁用的场景帧在视频生成（image-to-video）时被跳过，不参与首尾帧/中间帧。
 * @param index 场景帧索引
 */
async function toggleStageDisabled(index: number) {
  const stage = stageDefs.value[index]
  if (!stage) return
  try {
    await updateSceneStageFrame(props.project, props.episode, props.shot, index, {
      基础场景: stage.基础场景,
      登场角色: stage.登场角色,
      prompt: stage.prompt,
      disabled: !stage.disabled,
    })
    await load()
  } catch (e) {
    alert(e instanceof AssetApiError ? e.message : '操作失败')
  }
}

/** 打开视频生成对话框；所有场景帧均禁用时阻止并提示。 */
function openVideoGen() {
  if (stageDefs.value.length > 0 && disabledStageCount.value === stageDefs.value.length) {
    alert('所有场景帧均已禁用，无法生成视频（请至少启用一个场景帧）')
    return
  }
  genDialog.value = { show: true, type: 'video', index: 0 }
}

/**
 * 加载分镜导演台配置。
 *
 * 存在 director.json 时读取；否则依据 overview 时长与项目规格构造空白项目。
 */
async function loadDirector() {
  const ep = props.episode
  const shot = props.shot
  directorLoading.value = true
  try {
    const existing = await readDirectorConfig(props.project, ep, shot)
    if (existing) {
      director.value = existing
      return
    }
    let width = 0
    let height = 0
    let fps = 0
    try {
      const projRaw = await readFs(props.project, 'project.json')
      const obj = (typeof projRaw === 'string' ? JSON.parse(projRaw) : projRaw) as Record<string, unknown> | null
      width = Number(obj?.width) || 0
      height = Number(obj?.height) || 0
      fps = Number(obj?.fps) || 0
    } catch {
      // 无 project.json 时规格留空，由引擎回退 projectConfig
    }
    let duration = 5
    try {
      const ovRaw = await readFs(props.project, `prompt/scene/${ep}/${shot}/overview.json`)
      const ov = parseOverview(ovRaw)
      if (ov && ov.duration > 0) duration = ov.duration
    } catch {
      // 无 overview 时使用默认时长
    }
    director.value = emptyDirectorProject(duration, width, height, fps)
  } finally {
    directorLoading.value = false
  }
}

/**
 * 保存导演台配置到 director.json。
 */
async function saveDirector() {
  try {
    await writeDirectorConfig(props.project, props.episode, props.shot, director.value)
  } catch (e) {
    alert(e instanceof Error ? e.message : '导演台配置保存失败')
  }
}

/**
 * 生成视频：先保存导演台配置，再打开视频生成对话框。
 *
 * 导演台模式（存在图片块）不受场景帧禁用限制；否则沿用 openVideoGen 的校验。
 */
async function generateVideo() {
  try {
    await writeDirectorConfig(props.project, props.episode, props.shot, director.value)
  } catch (e) {
    alert(e instanceof Error ? e.message : '导演台配置保存失败，已取消生成')
    return
  }
  if (director.value.imageClips.length >= 1) {
    genDialog.value = { show: true, type: 'video', index: 0 }
    return
  }
  openVideoGen()
}

function openStageImageHistory(index: number) {
  historyDialog.value = {
    show: true,
    path: `assert/scene/${props.episode}/${props.shot}/stage/${index}.jpg`,
  }
}

function openVoiceHistory(index: number) {
  const name = data.value?.script[index]?.角色名
  if (!name) return
  historyDialog.value = {
    show: true,
    path: `assert/scene/${props.episode}/${props.shot}/voice/${index}-${name}.flac`,
  }
}

function openVideoHistory() {
  historyDialog.value = {
    show: true,
    path: `assert/scene/${props.episode}/${props.shot}/video/0.mp4`,
  }
}

const genImageDialog = computed({
  get: () => genDialog.value.show && genDialog.value.type === 'image',
  set: (v) => { if (!v) genDialog.value.show = false },
})
const genVoiceDialog = computed({
  get: () => genDialog.value.show && genDialog.value.type === 'voice',
  set: (v) => { if (!v) genDialog.value.show = false },
})
const genVideoDialog = computed({
  get: () => genDialog.value.show && genDialog.value.type === 'video',
  set: (v) => { if (!v) genDialog.value.show = false },
})
const genStageAssetDialog = computed({
  get: () => refGenDialog.value.show && refGenDialog.value.type === 'stage',
  set: (v) => { if (!v) refGenDialog.value.show = false },
})
const genCharacterAssetDialog = computed({
  get: () => refGenDialog.value.show && refGenDialog.value.type === 'character',
  set: (v) => { if (!v) refGenDialog.value.show = false },
})

const basePath = computed(() => `prompt/scene/${props.episode}/${props.shot}`)
const assertBase = computed(() => `/api/fs/${props.project}/assert/scene/${props.episode}/${props.shot}/stage`)

/** 引用同集上一分镜最后场景图的固定关键字。 */
const PREV_STAGE_REF = 'prev'

/** 登场角色与 prompt 同时为空 = 直接引用基础场景 / prev */
function isDirectStageRef(stage: Pick<StageDefinition, '登场角色' | 'prompt'>): boolean {
  return !(stage.登场角色?.length) && !(stage.prompt ?? '').trim()
}

/**
 * 是否为上一分镜最后场景引用。
 * @param ref 基础场景字段
 */
function isPrevStageRef(ref: string | undefined): boolean {
  return (ref ?? '').trim() === PREV_STAGE_REF
}

/**
 * 解析基础场景引用。
 * 支持 `场景名/标签` 与 `场景名/标签@变体id`；`prev` 返回 null（需分镜上下文）。
 */
function parseStageRef(ref: string): {
  name: string
  label: string
  variantId?: string
  assertPath: string
} | null {
  if (!ref) return null
  const trimmed = ref.trim()
  if (trimmed === PREV_STAGE_REF) return null
  // 自定义资产引用：custom/{完整路径含扩展名}，仅用于预览定位，不可作为场景设定图生成目标
  if (trimmed.startsWith('custom/')) {
    return {
      name: '',
      label: '',
      assertPath: `assert/custom/${trimmed.slice('custom/'.length)}`,
    }
  }
  const at = trimmed.indexOf('@')
  const main = at >= 0 ? trimmed.slice(0, at) : trimmed
  const variantId = at >= 0 ? trimmed.slice(at + 1).trim() : ''
  const idx = main.indexOf('/')
  if (idx <= 0 || idx >= main.length - 1) return null
  const name = main.slice(0, idx)
  const label = main.slice(idx + 1)
  if (!name || !label) return null
  if (variantId) {
    return {
      name,
      label,
      variantId,
      assertPath: `assert/stage/${name}/variants/${label}/${variantId}.jpg`,
    }
  }
  return {
    name,
    label,
    assertPath: `assert/stage/${name}/${label}.jpg`,
  }
}

/**
 * 解析 prev 对应的上一分镜最后场景图 assert 路径。
 * @returns assert 相对路径；无法解析时返回 null
 */
async function resolvePrevAssertPath(): Promise<string | null> {
  const shotNum = Number(String(props.shot).trim())
  if (!Number.isInteger(shotNum) || shotNum <= 1) return null
  const prevShot = String(shotNum - 1)
  try {
    const raw = await readFs(props.project, `prompt/scene/${props.episode}/${prevShot}/stage.json`)
    let defs: unknown = raw
    if (typeof raw === 'string') {
      defs = JSON.parse(raw || '[]')
    }
    if (!Array.isArray(defs) || defs.length === 0) return null
    return `assert/scene/${props.episode}/${prevShot}/stage/${defs.length - 1}.jpg`
  } catch {
    return null
  }
}

/**
 * 解析角色引用为 assert 路径。
 * 支持 `角色名` 与 `角色名@变体id`。
 */
function characterRefToAssertPath(ref: string): string | null {
  const trimmed = (ref ?? '').trim()
  if (!trimmed) return null
  // 自定义资产引用：custom/{完整路径含扩展名}
  if (trimmed.startsWith('custom/')) {
    return `assert/custom/${trimmed.slice('custom/'.length)}`
  }
  const at = trimmed.indexOf('@')
  if (at < 0) return `assert/character/${trimmed}/appearance.jpg`
  const name = trimmed.slice(0, at).trim()
  const variantId = trimmed.slice(at + 1).trim()
  if (!name || !variantId) return null
  return `assert/character/${name}/variants/${variantId}.jpg`
}

/**
 * 打开基础场景设定图生成对话框。
 * @param stageRef 基础场景引用（prev 不支持）
 */
function openStageAssetGen(stageRef: string) {
  const parsed = parseStageRef(stageRef)
  if (!parsed || !parsed.name) return
  refGenDialog.value = { show: true, type: 'stage', name: parsed.name, label: parsed.label, variantId: parsed.variantId }
}

/**
 * 打开角色设定图生成对话框。
 * @param charName 角色引用
 */
function openCharacterAssetGen(charName: string) {
  if (!charName) return
  // 变体图在角色详情中生成；自定义资产无需生成设定图
  if (charName.includes('@') || charName.startsWith('custom/')) return
  refGenDialog.value = { show: true, type: 'character', name: charName, label: '' }
}

/**
 * 加载基础场景与角色引用资产预览 URL。
 * @param stages 当前分镜场景定义列表
 */
async function loadRefAssets(stages: StageDefinition[]) {
  const stageRefs = new Set<string>()
  const charNames = new Set<string>()
  for (const stage of stages) {
    if (stage.基础场景) stageRefs.add(stage.基础场景)
    for (const name of stage.登场角色 ?? []) {
      if (name) charNames.add(name)
    }
  }

  const nextStageUrls: Record<string, string> = {}
  const nextCharUrls: Record<string, string> = {}
  const ts = Date.now()

  await Promise.all([
    ...[...stageRefs].map(async (ref) => {
      if (isPrevStageRef(ref)) {
        const path = await resolvePrevAssertPath()
        if (path && await existsFs(props.project, path)) {
          nextStageUrls[ref] = `/api/fs/${props.project}/${path}?t=${ts}`
        }
        return
      }
      const parsed = parseStageRef(ref)
      if (!parsed) return
      if (await existsFs(props.project, parsed.assertPath)) {
        nextStageUrls[ref] = `/api/fs/${props.project}/${parsed.assertPath}?t=${ts}`
      }
    }),
    ...[...charNames].map(async (name) => {
      const path = characterRefToAssertPath(name)
      if (!path) return
      if (await existsFs(props.project, path)) {
        nextCharUrls[name] = `/api/fs/${props.project}/${path}?t=${ts}`
      }
    }),
  ])

  stageAssetUrls.value = nextStageUrls
  characterAssetUrls.value = nextCharUrls
}

async function loadCharacters() {
  try {
    const res = await readFs(props.project, 'prompt/character') as DirResponse
    characterNames.value = (res.entries ?? [])
      .filter((e) => e.type === 'dir')
      .map((e) => e.name)
  } catch {
    characterNames.value = []
  }
}

function openScriptDialog(mode: 'add' | 'edit', index?: number) {
  if (mode === 'add') {
    scriptDialog.value = { show: true, mode: 'add', index: -1, entry: null }
  } else if (index !== undefined) {
    const entry = data.value?.script[index]
    if (!entry) return
    scriptDialog.value = { show: true, mode: 'edit', index, entry: { ...entry } }
  }
}

async function onScriptSave(form: ScriptForm) {
  if (scriptDialog.value.mode === 'add') {
    const arr = [...(data.value?.script ?? [])]
    arr.push(form)
    const path = `${basePath.value}/script.json`
    await writeFs(props.project, path, JSON.stringify(arr, null, 2))
    // 台词变化 → 使已合并音频失效（尽力而为，失败不阻塞保存）
    await deleteSceneMergedAudio(props.project, props.episode, props.shot).catch(() => {})
  } else {
    await updateSceneScriptEntry(
      props.project,
      props.episode,
      props.shot,
      scriptDialog.value.index,
      form,
    )
  }
  scriptDialog.value.show = false
  await load()
}

async function deleteScriptEntry(index: number) {
  const name = data.value?.script[index]?.角色名 ?? ''
  const ok = await confirm({
    title: '确认删除',
    content: `确定删除「${name}」的这条台词？对应的语音文件及历史版本也会删除。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  await deleteSceneScriptEntry(props.project, props.episode, props.shot, index)
  await load()
}

async function moveScriptEntry(from: number, to: number) {
  await reorderSceneScript(props.project, props.episode, props.shot, from, to)
  await load()
}

async function load() {
  const bp = basePath.value
  const ep = props.episode
  const shot = props.shot
  let scriptEntries: ScriptEntry[] = []

  try {
    const results = await Promise.all([
      readFs(props.project, `${bp}/overview.json`).catch(() => null),
      readFs(props.project, `${bp}/script.json`).catch(() => '[]'),
      readFs(props.project, `${bp}/prompt.md`).catch(() => ''),
      readFs(props.project, `${bp}/stage.json`).catch(() => ''),
    ])
    const overview = parseOverview(results[0])
    const scriptRaw = results[1]
    if (typeof scriptRaw === 'string') {
      scriptEntries = JSON.parse(scriptRaw || '[]') as ScriptEntry[]
    } else if (Array.isArray(scriptRaw)) {
      scriptEntries = scriptRaw as ScriptEntry[]
    } else {
      scriptEntries = []
    }
    data.value = {
      overview,
      script: scriptEntries,
      prompt: results[2] as string,
      stage: results[3] as unknown as StageDefinition[],
    }
  } catch (err) {
    console.log(err)
  }

  // 无论是否已生成图片，都展示 stage.json 原型定义
  try {
    const stage = data.value?.stage
    if (Array.isArray(stage)) {
      const checks = await Promise.all(
        stage.map((_, i) => existsFs(props.project, `assert/scene/${ep}/${shot}/stage/${i}.jpg`)),
      )
      stageDefs.value = stage.map((item, i) => ({
        基础场景: item.基础场景 ?? '',
        登场角色: item.登场角色 ?? [],
        prompt: item.prompt ?? '',
        disabled: (item as { disabled?: unknown }).disabled === true,
        imageUrl: checks[i] ? `${assertBase.value}/${i}.jpg?t=${Date.now()}` : '',
      }))
      await loadRefAssets(stageDefs.value)
    } else {
      stageDefs.value = []
      stageAssetUrls.value = {}
      characterAssetUrls.value = {}
    }
  } catch {
    stageDefs.value = []
    stageAssetUrls.value = {}
    characterAssetUrls.value = {}
  }

  // Check voice assets for each script entry: {index}-{角色名}.flac
  if (scriptEntries.length) {
    const ts = Date.now()
    const voiceUrls = await Promise.all(
      scriptEntries.map(async (entry, i) => {
        const rel = `assert/scene/${ep}/${shot}/voice/${i}-${entry.角色名}.flac`
        if (await existsFs(props.project, rel)) {
          return `/api/fs/${props.project}/${rel}?t=${ts}`
        }
        return ''
      }),
    )
    voiceAssets.value = voiceUrls
  } else {
    voiceAssets.value = []
  }

  // Check video asset
  hasVideo.value = await existsFs(props.project, `assert/scene/${ep}/${shot}/video/0.mp4`)

  // 检查是否存在用户编辑保存的分镜合并音频
  const mergedRel = `assert/scene/${ep}/${shot}/audio/merged.flac`
  if (await existsFs(props.project, mergedRel)) {
    hasMergedAudio.value = true
    mergedAudioUrl.value = `/api/fs/${props.project}/${mergedRel}?t=${Date.now()}`
  } else {
    hasMergedAudio.value = false
    mergedAudioUrl.value = ''
  }
}

function edit(field: string) {
  dialog.value = { show: true, field, content: data.value![field as keyof SceneData] as string }
}

function editJson(field: string) {
  dialog.value = { show: true, field, content: JSON.stringify(data.value![field as keyof SceneData], null, 2) }
}

function editOverview() {
  overviewDialog.value = {
    show: true,
    saving: false,
    form: cloneOverview(data.value?.overview),
  }
}

function editStageJson() {
  dialog.value = {
    show: true,
    field: 'stage',
    content: JSON.stringify(
      stageDefs.value.map(({ 基础场景, 登场角色, prompt, disabled }) => ({
        基础场景,
        登场角色,
        prompt,
        ...(disabled ? { disabled: true } : {}),
      })),
      null,
      2,
    ),
  }
}

async function saveOverview() {
  if (overviewDurationError.value) {
    alert(overviewDurationError.value)
    return
  }

  const form = overviewDialog.value.form
  const duration = Number(form.duration)
  if (!isPositiveInt(duration)) {
    alert('时长必须是大于 0 的整数秒')
    return
  }
  const payload: ShotOverview = {
    title: (form.title ?? '').trim(),
    beat: form.beat ?? '',
    visual: form.visual ?? '',
    camera: form.camera ?? '',
    duration,
    mood: form.mood ?? '',
  }

  overviewDialog.value.saving = true
  try {
    await writeFs(props.project, `${basePath.value}/overview.json`, JSON.stringify(payload, null, 2))
    if (data.value) data.value.overview = payload
    overviewDialog.value.show = false
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : '保存失败')
  } finally {
    overviewDialog.value.saving = false
  }
}

async function save() {
  const field = dialog.value.field
  const content = dialog.value.content

  if (field === 'stage') {
    try {
      const parsed = JSON.parse(content)
      if (!Array.isArray(parsed)) {
        alert('stage.json 必须是数组')
        return
      }
    } catch (e: unknown) {
      alert('JSON 格式错误: ' + (e as Error).message)
      return
    }
    await writeFs(props.project, `${basePath.value}/stage.json`, content)
    dialog.value.show = false
    await load()
    return
  }

  const file = field === 'script' ? 'script.json' : `${field}.md`
  if (field === 'script') {
    try { JSON.parse(content) } catch (e: unknown) { alert('JSON 格式错误: ' + (e as Error).message); return }
  }
  await writeFs(props.project, `${basePath.value}/${file}`, content)
  if (field === 'script') {
    if (data.value) data.value.script = JSON.parse(content)
    // 台词变化 → 使已合并音频失效（尽力而为，失败不阻塞保存）
    await deleteSceneMergedAudio(props.project, props.episode, props.shot).catch(() => {})
    hasMergedAudio.value = false
    mergedAudioUrl.value = ''
  } else if (data.value && field === 'prompt') {
    data.value.prompt = content
  }
  dialog.value.show = false
}

watch(() => [props.project, props.episode, props.shot], () => { void load(); void loadDirector() }, { immediate: true })
watch(() => props.project, loadCharacters, { immediate: true })
</script>

<style scoped>

.stage-prompt,
.overview-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

/* 禁用的场景帧：整体淡化并高亮边框，提示视频生成时将跳过 */
.stage-disabled-card {
  opacity: 0.7;
  border-color: rgb(var(--v-theme-warning)) !important;
}
</style>
