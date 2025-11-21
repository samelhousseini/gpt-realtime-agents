targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the the environment which is used to generate a short unique hash used in all resources.')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

param resourceGroupName string = ''

param applicationInsightsName string = ''
param logAnalyticsName string = ''

param webRTCUrl string = ''
param gptRealtimeUrl string = ''
param gptRealtimeKey string = ''
param azureOpenAiEndpointWs string = ''
param azureOpenAiApiKey string = ''
param azureOpenAiModelName string = ''
param azureAcsConnKey string = ''
param acsPhoneNumber string = ''

param azureVoiceLiveEndpoint string = ''
param azureVoiceLiveApiKey string = ''
param azureVoiceLiveModel string = ''
param azureVoiceLiveVoice string = ''
param azureVoiceLiveRegion string = ''
param azureVoiceLiveApiVersion string = ''
param useVoiceLiveForAcs string = ''

param containerAppsEnvironmentName string = ''
param containerRegistryName string = ''

param audioBackendContainerAppName string = ''
param audioBackendAppExists bool = false



var abbrs = loadJsonContent('shared/abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName, assignedTo: environmentName }
var audioBackendName = !empty(audioBackendContainerAppName) ? audioBackendContainerAppName : '${abbrs.appContainerApps}audio-backend-${resourceToken}'
var audioBackendUri = 'https://${audioBackendName}.${containerApps.outputs.defaultDomain}'

// Organize resources in a resource group
resource resourceGroup 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: !empty(resourceGroupName) ? resourceGroupName : '${abbrs.resourcesResourceGroups}${environmentName}'
  location: location
  tags: tags
}

// Monitor application with Azure Monitor
module monitoring 'shared/monitor/monitoring.bicep' = {
  name: 'monitoring'
  scope: resourceGroup
  params: {
    location: location
    tags: tags
    applicationInsightsName: !empty(applicationInsightsName) ? applicationInsightsName : '${abbrs.insightsComponents}${resourceToken}'
    logAnalyticsName: !empty(logAnalyticsName) ? logAnalyticsName : '${abbrs.operationalInsightsWorkspaces}${resourceToken}'
  }
}


module containerApps 'shared/host/container-apps.bicep' = {
  name: 'container-apps'
  scope: resourceGroup
  params: {
    name: 'app'
    location: location
    tags: tags
    containerAppsEnvironmentName: !empty(containerAppsEnvironmentName) ? containerAppsEnvironmentName : '${abbrs.appManagedEnvironments}${resourceToken}'
    containerRegistryName: !empty(containerRegistryName) ? containerRegistryName : '${abbrs.containerRegistryRegistries}${resourceToken}'
    logAnalyticsWorkspaceName: monitoring.outputs.logAnalyticsWorkspaceName
    applicationInsightsName: monitoring.outputs.applicationInsightsName
  }
}

// audioBackend backend
module audioBackend 'app/audio-backend.bicep' = {
  name: 'audio-backend'
  scope: resourceGroup
  params: {
    name: audioBackendName
    location: location
    tags: tags
    identityName: '${abbrs.managedIdentityUserAssignedIdentities}audio-backend-${resourceToken}'
    applicationInsightsName: monitoring.outputs.applicationInsightsName
    containerAppsEnvironmentName: containerApps.outputs.environmentName
    containerRegistryName: containerApps.outputs.registryName
    corsAcaUrl: ''
    exists: audioBackendAppExists
    env: [
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
        value: monitoring.outputs.applicationInsightsInstrumentationKey
      }
      {
        name: 'SEMANTICKERNEL_EXPERIMENTAL_GENAI_ENABLE_OTEL_DIAGNOSTICS_SENSITIVE'
        value: true
      }
      {
        name: 'VITE_BACKEND_BASE_URL'
        value: '${audioBackendUri}/api'
      }
      {
        name: 'WEBRTC_URL'
        value: webRTCUrl
      }
      {
        name: 'AZURE_GPT_REALTIME_URL'
        value: gptRealtimeUrl
      }
      {
        name: 'AZURE_GPT_REALTIME_KEY'
        value: gptRealtimeKey
      }
      {
        name: 'AZURE_OPENAI_ENDPOINT_WS'
        value: azureOpenAiEndpointWs
      }
      {
        name: 'AZURE_OPENAI_API_KEY'
        value: azureOpenAiApiKey
      }
      {
        name: 'AZURE_OPENAI_MODEL_NAME'
        value: azureOpenAiModelName
      }
      {
        name: 'AZURE_ACS_CONN_KEY'
        value: azureAcsConnKey
      }
      {
        name: 'ACS_PHONE_NUMBER'
        value: acsPhoneNumber
      }
      {
        name: 'CALLBACK_EVENTS_URI'
        value: '${audioBackendUri}/api/callbacks'
      }
      {
        name: 'CALLBACK_URI_HOST'
        value: replace(audioBackendUri, 'https://', 'wss://')
      }
      {
        name: 'AZURE_VOICELIVE_ENDPOINT'
        value: azureVoiceLiveEndpoint
      }
      {
        name: 'AZURE_VOICELIVE_API_KEY'
        value: azureVoiceLiveApiKey
      }
      {
        name: 'AZURE_VOICELIVE_MODEL'
        value: azureVoiceLiveModel
      }
      {
        name: 'AZURE_VOICELIVE_VOICE'
        value: azureVoiceLiveVoice
      }
      {
        name: 'AZURE_VOICELIVE_REGION'
        value: azureVoiceLiveRegion
      }
      {
        name: 'AZURE_VOICELIVE_API_VERSION'
        value: azureVoiceLiveApiVersion
      }
      {
        name: 'USE_VOICELIVE_FOR_ACS'
        value: useVoiceLiveForAcs
      }
    ]
  }
}



output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_RESOURCE_GROUP string = resourceGroup.name


output AZURE_CONTAINER_ENVIRONMENT_NAME string = containerApps.outputs.environmentName
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerApps.outputs.registryLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = containerApps.outputs.registryName
output AZURE_AUDIO_BACKEND_URL string = audioBackendUri

