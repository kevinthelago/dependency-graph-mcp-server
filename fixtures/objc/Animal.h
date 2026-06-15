/**
 * Animal.h — base class header.
 *
 * Tests:
 *   - @interface declaration (class symbol)
 *   - @protocol declaration
 *   - #import with local quoted path
 *   - #define macro symbol
 */

#import "Foundation/Foundation.h"
#import "Habitat.h"

#ifndef ANIMAL_MAX_LEGS
#define ANIMAL_MAX_LEGS 8
#endif

@protocol Locomotion <NSObject>
- (void)move;
@end

@interface Animal : NSObject <Locomotion>

@property (nonatomic, copy) NSString *name;
@property (nonatomic, assign) NSUInteger legCount;

- (instancetype)initWithName:(NSString *)name;

@end
