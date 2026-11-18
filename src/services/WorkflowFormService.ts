import { getConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import type { HotelSearchCriteria } from './HotelIntakeService.js';
import type { LogisticsSearchCriteria } from './logisticsRequestMapper.js';
import { getHotelIntakeService } from './HotelIntakeService.js';
import { getHotelSearchSessionService } from './hotelSearchSessionService.js';
import { getRestaurantSearchSessionService } from './restaurantSearchSessionService.js';
import { getExcursionSearchSessionService } from './excursionSearchSessionService.js';
import { getLogisticsSearchSessionService } from './logisticsSearchSessionService.js';
import { getItinerarySessionService } from './itinerarySessionService.js';
import { getProfileService } from './profileService.js';
import { getFormTokenService } from './formTokenService.js';
import {
  buildHotelCollectionResponse, buildHotelFormLink,
  buildRestaurantCollectionResponse, buildRestaurantFormLink,
  buildExcursionCollectionResponse, buildExcursionFormLink,
  buildLogisticsCollectionResponse, buildLogisticsFormLink,
  buildItineraryCollectionResponse, buildItineraryFormLink,
} from '../utils/formResponses.js';

export type WorkflowFormType = 'hotel' | 'restaurant' | 'excursion' | 'logistics' | 'itinerary';

/** Performs the existing validated form-opening effects for one workflow. */
export async function openWorkflowForm(
  userId: string,
  flow: WorkflowFormType,
  originalMessage: string,
  initialCriteria: HotelSearchCriteria | LogisticsSearchCriteria = {}
): Promise<string> {
  if (flow === 'hotel') await getHotelIntakeService().clear(userId);
  await getConversationControlPlane().pauseCompetingWorkflows(userId, flow);
  if (flow !== 'hotel') await getHotelIntakeService().clear(userId);

  const profile = await getProfileService().getProfile(userId);
  const token = getFormTokenService().createToken(userId, flow);
  switch (flow) {
    case 'hotel':
      if (Object.keys(initialCriteria).length) {
        await getHotelSearchSessionService().saveHotelFormSent(userId, originalMessage, profile?.form,
          initialCriteria as HotelSearchCriteria);
      } else {
        await getHotelSearchSessionService().saveHotelFormSent(userId, originalMessage, profile?.form);
      }
      return buildHotelCollectionResponse(buildHotelFormLink(token));
    case 'restaurant':
      await getRestaurantSearchSessionService().saveRestaurantFormSent(userId, originalMessage, profile?.form);
      return buildRestaurantCollectionResponse(buildRestaurantFormLink(token));
    case 'excursion':
      await getExcursionSearchSessionService().saveExcursionFormSent(userId, originalMessage, profile?.form);
      return buildExcursionCollectionResponse(buildExcursionFormLink(token));
    case 'logistics':
      if (Object.keys(initialCriteria).length) {
        await getLogisticsSearchSessionService().saveTransportFormSent(userId, originalMessage, profile?.form,
          initialCriteria as LogisticsSearchCriteria);
      } else {
        await getLogisticsSearchSessionService().saveTransportFormSent(userId, originalMessage, profile?.form);
      }
      return buildLogisticsCollectionResponse(buildLogisticsFormLink(token));
    case 'itinerary':
      await getItinerarySessionService().saveFormSent(userId, originalMessage, profile?.form);
      return buildItineraryCollectionResponse(buildItineraryFormLink(token));
  }
}
