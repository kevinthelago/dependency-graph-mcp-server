/**
 * Habitat.h — simple header imported by Animal.h.
 *
 * Tests:
 *   - @import framework (external leaf)
 *   - @class forward declaration (reference edge)
 *   - @interface with no superclass
 */

@import Foundation;
@import MapKit;

@class Animal;

@interface Habitat : NSObject

@property (nonatomic, copy) NSString *biome;
@property (nonatomic, weak) Animal *topPredator;

@end
